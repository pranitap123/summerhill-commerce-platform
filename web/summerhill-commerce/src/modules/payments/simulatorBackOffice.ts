import { randomBytes } from 'node:crypto'

import type Stripe from 'stripe'

import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import type {
  BalanceTransaction,
  ConnectedAccountInfo,
  PaymentGateway,
  PaymentIntentInfo,
} from './gateway'
import { STRIPE_API_VERSION } from './stripe'

export const SIM_DISPUTE_FEE_CENTS = 1500

export interface SimIntent extends PaymentIntentInfo {
  destination?: string | null

  disputeReason?: string | null
  refundedCents?: number
  reversedCents?: number
  feeRefundedCents?: number
}

export interface SimAccount {
  id: string
  merchantId: number | null
  name: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  availableCents: number
  pendingCents: number
  payoutInterval: string
  returnUrl: string | null
  refreshUrl: string | null
}

export interface SimDispute {
  id: string
  chargeId: string
  paymentIntentId: string
  amountCents: number
  reason: string
  status: string
  evidence: Record<string, string> | null
  dueBy: string
}

const newId = (prefix: string) => `${prefix}_sim_${randomBytes(12).toString('hex')}`

async function load<T>(db: Db, id: string, lock = false): Promise<T | null> {
  const { rows } = await db.query<{ data: T }>(
    `SELECT data FROM ops.payment_simulator WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0]?.data ?? null
}

async function save(db: Db, kind: string, id: string, data: unknown): Promise<void> {
  await db.query(
    `INSERT INTO ops.payment_simulator (id, kind, data) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, kind, JSON.stringify(data)],
  )
}

async function idempotent<T>(key: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    const id = `idem:${key}`
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id])
    const done = await load<{ result: T }>(tx, id)
    if (done) return done.result
    const result = await fn(tx)
    await save(tx, 'idempotency_key', id, { result })
    return result
  })
}

async function balanceTxn(
  db: Db,
  type: string,
  sourceId: string | null,
  amountCents: number,
  feeCents = 0,
): Promise<void> {
  const id = newId('txn')
  await save(db, 'balance_transaction', id, {
    id,
    type,
    sourceId,
    amountCents,
    feeCents,
    created: new Date().toISOString(),
  })
}

async function credit(db: Db, accountId: string | null | undefined, cents: number): Promise<void> {
  if (!accountId || cents === 0) return
  const account = (await load<SimAccount>(db, accountId, true)) ?? {
    id: accountId,
    merchantId: null,
    name: accountId,
    chargesEnabled: true,
    payoutsEnabled: true,
    availableCents: 0,
    pendingCents: 0,
    payoutInterval: 'manual',
    returnUrl: null,
    refreshUrl: null,
  }

  await save(db, 'account', accountId, {
    ...account,
    availableCents: account.availableCents + cents,
  })
}

export function proportionalFeeRefund(
  feeCents: number,
  capturedCents: number,
  merchantShareTotalCents: number,
): number {
  if (capturedCents === 0) return 0
  return Math.min(
    feeCents,
    Math.floor((2 * feeCents * merchantShareTotalCents + capturedCents) / (2 * capturedCents)),
  )
}

async function intentByCharge(db: Db, chargeId: string): Promise<SimIntent | null> {
  const { rows } = await db.query<{ data: SimIntent }>(
    `SELECT data FROM ops.payment_simulator WHERE kind = 'payment_intent' AND data->>'chargeId' = $1
     FOR UPDATE`,
    [chargeId],
  )
  return rows[0]?.data ?? null
}

async function recordEvent(
  type: string,
  object: Record<string, unknown>,
  account: string | null,
): Promise<void> {
  const { recordWebhookEvent } = await import('./webhooks')
  const event = {
    id: newId('evt'),
    object: 'event',
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: STRIPE_API_VERSION,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    ...(account ? { account } : {}),
    data: { object },
  } as unknown as Stripe.Event
  await recordWebhookEvent(event, account ? 'connect' : 'platform')
}

export async function afterSimulatedCapture(tx: Db, pi: SimIntent): Promise<SimDispute | null> {
  const captured = pi.amountReceivedCents
  const fee = pi.applicationFeeCents ?? 0
  await balanceTxn(tx, 'charge', pi.chargeId, captured, pi.processingFeeCents ?? 0)
  await balanceTxn(tx, 'transfer', `tr_${pi.chargeId}`, -captured)
  await balanceTxn(tx, 'application_fee', `fee_${pi.chargeId}`, fee)
  await credit(tx, pi.destination, captured - fee)
  if (!pi.disputeReason || !pi.chargeId) return null
  const dispute: SimDispute = {
    id: newId('dp'),
    chargeId: pi.chargeId,
    paymentIntentId: pi.id,
    amountCents: captured,
    reason: pi.disputeReason,
    status: 'needs_response',
    evidence: null,
    dueBy: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }
  await save(tx, 'dispute', dispute.id, dispute)
  await balanceTxn(tx, 'adjustment', dispute.id, -captured, SIM_DISPUTE_FEE_CENTS)
  return dispute
}

export function disputeObject(d: SimDispute): Record<string, unknown> {
  return {
    id: d.id,
    object: 'dispute',
    amount: d.amountCents,
    currency: 'cad',
    charge: d.chargeId,
    payment_intent: d.paymentIntentId,
    reason: d.reason,
    status: d.status,
    evidence_details: { due_by: Math.floor(new Date(d.dueBy).getTime() / 1000) },
    balance_transactions: [{ amount: -d.amountCents, fee: SIM_DISPUTE_FEE_CENTS }],
  }
}

export async function announceDispute(d: SimDispute): Promise<void> {
  await recordEvent('charge.dispute.created', disputeObject(d), null)
}

function accountInfo(a: SimAccount): ConnectedAccountInfo {
  return {
    id: a.id,
    chargesEnabled: a.chargesEnabled,
    payoutsEnabled: a.payoutsEnabled,
    disabledReason: a.chargesEnabled ? null : 'requirements.past_due',
    currentlyDue: a.chargesEnabled
      ? []
      : ['business_profile.url', 'external_account', 'tos_acceptance.date'],
  }
}

function accountObject(a: SimAccount): Record<string, unknown> {
  const info = accountInfo(a)
  return {
    id: a.id,
    object: 'account',
    charges_enabled: a.chargesEnabled,
    payouts_enabled: a.payoutsEnabled,
    requirements: { disabled_reason: info.disabledReason, currently_due: info.currentlyDue },
  }
}

export async function getSimAccount(id: string, db: Db = getDb()): Promise<SimAccount | null> {
  return /^acct_sim_[0-9a-f]{24}$/.test(id) ? load<SimAccount>(db, id) : null
}

export async function completeSimulatedOnboarding(accountId: string): Promise<string | null> {
  const account = await withTransaction(async (tx) => {
    const a = await load<SimAccount>(tx, accountId, true)
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'No such account')
    const done = { ...a, chargesEnabled: true, payoutsEnabled: true }
    await save(tx, 'account', a.id, done)
    return done
  })
  await recordEvent('account.updated', accountObject(account), account.id)
  return account.returnUrl
}

type BackOffice = Pick<
  PaymentGateway,
  | 'refund'
  | 'reverseTransfer'
  | 'createExpressAccount'
  | 'createCustomAccount'
  | 'createOnboardingLink'
  | 'retrieveAccount'
  | 'retrieveBalance'
  | 'createPayout'
  | 'updatePayoutSchedule'
  | 'listBalanceTransactions'
  | 'submitDisputeEvidence'
>

export function simulatedBackOffice(serverUrl: string): BackOffice {
  return {
    async refund(params, idempotencyKey) {
      return idempotent(`refund:${idempotencyKey}`, async (tx) => {
        const pi = await load<SimIntent>(tx, params.paymentIntentId, true)
        if (!pi || pi.status !== 'succeeded')
          throw new Error('This PaymentIntent has no captured charge to refund (simulator)')
        const refunded = pi.refundedCents ?? 0
        if (params.amountCents > pi.amountReceivedCents - refunded)
          throw new Error('Refund amount is greater than the unrefunded amount (simulator)')
        const id = newId('re')
        await balanceTxn(tx, 'refund', id, -params.amountCents)
        const next: SimIntent = { ...pi, refundedCents: refunded + params.amountCents }
        let reversal: string | null = null
        let feeTotal: number | null = null
        if (params.reverseTransfer) {
          reversal = newId('trr')
          next.reversedCents = (pi.reversedCents ?? 0) + params.amountCents
          await balanceTxn(tx, 'transfer_refund', reversal, params.amountCents)
          await credit(tx, pi.destination, -params.amountCents)
        }
        if (params.refundApplicationFee) {
          feeTotal = proportionalFeeRefund(
            pi.applicationFeeCents ?? 0,
            pi.amountReceivedCents,
            next.reversedCents ?? 0,
          )
          const f = feeTotal - (pi.feeRefundedCents ?? 0)
          next.feeRefundedCents = feeTotal
          await balanceTxn(tx, 'application_fee_refund', newId('fr'), -f)
          await credit(tx, pi.destination, f)
        }
        await save(tx, 'payment_intent', pi.id, next)
        await save(tx, 'refund', id, {
          id,
          paymentIntentId: pi.id,
          amountCents: params.amountCents,
        })
        return {
          id,
          status: 'succeeded' as const,
          amountCents: params.amountCents,
          transferReversalId: reversal,
          applicationFeeRefundedTotalCents: feeTotal,
          failureReason: null,
        }
      })
    },

    async reverseTransfer(params, idempotencyKey) {
      return idempotent(`reversal:${idempotencyKey}`, async (tx) => {
        const pi = await intentByCharge(tx, params.chargeId)
        if (!pi) throw new Error(`No such charge: '${params.chargeId}' (simulator)`)
        const reversed = (pi.reversedCents ?? 0) + params.amountCents
        if (reversed > pi.amountReceivedCents)
          throw new Error('Transfer reversal exceeds the transfer (simulator)')
        const id = newId('trr')
        await balanceTxn(tx, 'transfer_refund', id, params.amountCents)
        await credit(tx, pi.destination, -params.amountCents)
        const next: SimIntent = { ...pi, reversedCents: reversed }
        let feeTotal: number | null = null
        if (params.refundApplicationFee) {
          feeTotal = proportionalFeeRefund(
            pi.applicationFeeCents ?? 0,
            pi.amountReceivedCents,
            reversed,
          )
          const f = feeTotal - (pi.feeRefundedCents ?? 0)
          next.feeRefundedCents = feeTotal
          await balanceTxn(tx, 'application_fee_refund', newId('fr'), -f)
          await credit(tx, pi.destination, f)
        }
        await save(tx, 'payment_intent', pi.id, next)
        return { id, amountCents: params.amountCents, applicationFeeRefundedTotalCents: feeTotal }
      })
    },

    async createExpressAccount(params, idempotencyKey) {
      return idempotent(`account:${idempotencyKey}`, async (tx) => {
        const account: SimAccount = {
          id: newId('acct'),
          merchantId: params.merchantId,
          name: params.name,
          chargesEnabled: false,
          payoutsEnabled: false,
          availableCents: 0,
          pendingCents: 0,
          payoutInterval: 'daily',
          returnUrl: null,
          refreshUrl: null,
        }
        await save(tx, 'account', account.id, account)
        return { id: account.id }
      })
    },

    async createCustomAccount(params, idempotencyKey) {
      return idempotent(`account:${idempotencyKey}`, async (tx) => {
        const account: SimAccount = {
          id: newId('acct'),
          merchantId: params.merchantId,
          name: params.name,
          chargesEnabled: true,
          payoutsEnabled: true,
          availableCents: 0,
          pendingCents: 0,
          payoutInterval: 'daily',
          returnUrl: null,
          refreshUrl: null,
        }
        await save(tx, 'account', account.id, account)
        return { id: account.id }
      })
    },

    async createOnboardingLink(accountId, refreshUrl, returnUrl) {
      await withTransaction(async (tx) => {
        const a = await load<SimAccount>(tx, accountId, true)
        if (!a) throw new Error(`No such account: '${accountId}' (simulator)`)
        await save(tx, 'account', a.id, { ...a, returnUrl, refreshUrl })
      })
      return `${serverUrl}/simulator/onboarding/${accountId}`
    },

    async retrieveAccount(accountId) {
      const a = await load<SimAccount>(getDb(), accountId)
      if (!a) throw new Error(`No such account: '${accountId}' (simulator)`)
      return accountInfo(a)
    },

    async retrieveBalance(accountId) {
      const a = await load<SimAccount>(getDb(), accountId)
      return { availableCents: a?.availableCents ?? 0, pendingCents: a?.pendingCents ?? 0 }
    },

    async createPayout(accountId, amountCents, metadata, idempotencyKey) {
      const payout = await idempotent(`payout:${idempotencyKey}`, async (tx) => {
        const a = await load<SimAccount>(tx, accountId, true)
        if (!a) throw new Error(`No such account: '${accountId}' (simulator)`)
        if (a.availableCents < amountCents)
          throw new Error('You have insufficient funds in your Stripe account (simulator)')
        const id = newId('po')
        await save(tx, 'account', a.id, { ...a, availableCents: a.availableCents - amountCents })
        const arrival = new Date(Date.now() + 2 * 86_400_000)
        await save(tx, 'payout', id, { id, accountId, amountCents, metadata, status: 'paid' })
        return { id, arrival: arrival.toISOString() }
      })

      await recordEvent(
        'payout.paid',
        {
          id: payout.id,
          object: 'payout',
          amount: amountCents,
          currency: 'cad',
          status: 'paid',
          arrival_date: Math.floor(new Date(payout.arrival).getTime() / 1000),
          metadata,
          automatic: false,
        },
        accountId,
      )
      return { id: payout.id, status: 'pending' as const, arrivalDate: new Date(payout.arrival) }
    },

    async updatePayoutSchedule(accountId, interval) {
      await withTransaction(async (tx) => {
        const a = await load<SimAccount>(tx, accountId, true)
        if (a) await save(tx, 'account', a.id, { ...a, payoutInterval: interval })
      })
    },

    async listBalanceTransactions({ from, to }) {
      const { rows } = await getDb().query<{ data: BalanceTransaction & { created: string } }>(
        `SELECT data FROM ops.payment_simulator WHERE kind = 'balance_transaction'
           AND created_at >= $1 AND created_at < $2 ORDER BY created_at`,
        [from, to],
      )
      return rows.map((r) => ({ ...r.data, created: new Date(r.data.created) }))
    },

    async submitDisputeEvidence(disputeId, evidence) {
      return withTransaction(async (tx) => {
        const d = await load<SimDispute>(tx, disputeId, true)
        if (!d) throw new Error(`No such dispute: '${disputeId}' (simulator)`)
        await save(tx, 'dispute', d.id, { ...d, evidence, status: 'under_review' })
        return { status: 'under_review' }
      })
    },
  }
}
