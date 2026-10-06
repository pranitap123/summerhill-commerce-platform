import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { afterAll, beforeAll } from 'vitest'

import type {
  BalanceTransaction,
  PaymentGateway,
  PaymentIntentInfo,
  RefundInfo,
} from '@/modules/payments'

import { createTestDb, sql, type TestDb } from './testDb'

/**
 * Shared integration harness (G2-17, G4): a throwaway database per test file (as app_rw), the real
 * route handlers and worker loop, an in-memory Stripe with test-mode semantics, captured email,
 * and a tiny browser that keeps cookies. Call `setupIntegrationHarness()` once at the top of a test
 * file; `db`, `m`, `stripe` and `mail` are live bindings filled in by its beforeAll.
 */
export const WEBHOOK_SECRET = 'whsec_test_integration_only'
export const ACCT = 'acct_test_integration'

// ---------------------------------------------------------------- fake Stripe (test-mode semantics)
export class FakeStripe implements PaymentGateway {
  sessions = new Map<
    string,
    {
      params: Stripe.Checkout.SessionCreateParams
      status: 'open' | 'complete' | 'expired'
      pi: string
    }
  >()
  intents = new Map<string, PaymentIntentInfo>()
  captures: Array<{ id: string; amounts: unknown; key: string }> = []
  cancels: string[] = []
  private byKey = new Map<string, string>()
  private n = 0
  captureShouldFail = false
  /** Stripe's fee isn't known at capture (reconciliation posts it later, PAYMENTS §10). */
  lateFees = false

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams, key: string) {
    const existing = this.byKey.get(key)
    const id = existing ?? `cs_test_${++this.n}`
    if (!existing) {
      this.byKey.set(key, id)
      this.sessions.set(id, { params, status: 'open', pi: `pi_test_${this.n}` })
    }
    return {
      id,
      url: `https://checkout.stripe.test/${id}`,
      expiresAt: new Date(params.expires_at! * 1000),
    }
  }
  async expireCheckoutSession(id: string) {
    const s = this.sessions.get(id)!
    if (s.status === 'complete') return 'complete' as const
    if (s.status === 'expired') return 'already_expired' as const
    s.status = 'expired'
    return 'expired' as const
  }
  /** The customer pays: the card is authorised for the session total. */
  pay(sessionId: string, captureBefore = new Date(Date.now() + 7 * 86_400_000)) {
    const s = this.sessions.get(sessionId)!
    s.status = 'complete'
    const amount = s.params.line_items!.reduce(
      (sum, l) => sum + l.price_data!.unit_amount! * l.quantity!,
      0,
    )
    this.intents.set(s.pi, {
      id: s.pi,
      status: 'requires_capture',
      amountCapturableCents: amount,
      amountReceivedCents: 0,
      applicationFeeCents: s.params.payment_intent_data!.application_fee_amount!,
      chargeId: `ch_${s.pi}`,
      captureBefore,
      overcaptureStatus: 'unavailable',
      overcaptureMaximumCents: amount,
      incrementalAuthorizationStatus: 'available',
      extendedAuthorizationStatus: 'disabled',
      processingFeeCents: null,
    })
    return s
  }
  async retrievePaymentIntent(id: string) {
    return this.intents.get(id)!
  }
  async capturePaymentIntent(
    id: string,
    amounts: { amountToCaptureCents: number; applicationFeeCents: number },
    key: string,
  ) {
    if (this.captureShouldFail) throw new Error('Stripe API error (simulated)')
    this.captures.push({ id, amounts, key })
    const pi = this.intents.get(id)!
    const captured = amounts.amountToCaptureCents
    Object.assign(pi, {
      status: 'succeeded',
      amountCapturableCents: 0,
      amountReceivedCents: captured,
      applicationFeeCents: amounts.applicationFeeCents,
      processingFeeCents: Math.round(captured * 0.029) + 30,
    })
    this.recordCapture(id)
    if (this.lateFees) return { ...pi, processingFeeCents: null }
    return pi
  }
  async cancelPaymentIntent(id: string) {
    this.cancels.push(id)
    const pi = this.intents.get(id)!
    pi.status = 'canceled'
    return pi
  }

  // ---- back office (G5): Stripe's destination-charge flow of funds, in memory
  balanceTxns: BalanceTransaction[] = []
  accounts = new Map<
    string,
    { charges: boolean; payouts: boolean; available: number; interval: string }
  >([[ACCT, { charges: true, payouts: true, available: 0, interval: 'manual' }]])
  refunds: Array<{ id: string; params: unknown; key: string }> = []
  reversals: Array<{ id: string; chargeId: string; amountCents: number }> = []
  payouts: Array<{ id: string; account: string; amountCents: number; key: string }> = []
  evidence = new Map<string, Record<string, string>>()
  refundShouldFail = false
  /** Refunds come back `pending` (finished later by a refund.updated webhook). */
  refundsPending = false
  private sums = new Map<string, { refunded: number; reversed: number; feeRefunded: number }>()
  private seq = 0
  private byIdempotency = new Map<string, unknown>()
  private txn(type: string, sourceId: string | null, amountCents: number, feeCents = 0) {
    this.balanceTxns.push({
      id: `txn_${++this.seq}`,
      type,
      sourceId,
      amountCents,
      feeCents,
      created: new Date(),
    })
  }
  private once<T>(key: string, fn: () => T): T {
    if (this.byIdempotency.has(key)) return this.byIdempotency.get(key) as T
    const result = fn()
    this.byIdempotency.set(key, result)
    return result
  }
  private credit(account: string, cents: number) {
    const a = this.accounts.get(account)
    if (a) a.available += cents
  }
  private feeTotal(pi: PaymentIntentInfo, reversed: number) {
    const fee = pi.applicationFeeCents ?? 0
    const captured = pi.amountReceivedCents
    return Math.min(fee, Math.floor((2 * fee * reversed + captured) / (2 * captured)))
  }
  /** Called by capturePaymentIntent's callers in tests that check reconciliation. */
  recordCapture(piId: string) {
    const pi = this.intents.get(piId)!
    this.txn('charge', pi.chargeId, pi.amountReceivedCents, pi.processingFeeCents ?? 0)
    this.txn('transfer', `tr_${pi.chargeId}`, -pi.amountReceivedCents)
    this.txn('application_fee', `fee_${pi.chargeId}`, pi.applicationFeeCents ?? 0)
    this.credit(ACCT, pi.amountReceivedCents - (pi.applicationFeeCents ?? 0))
  }
  async refund(
    params: {
      paymentIntentId: string
      amountCents: number
      reverseTransfer: boolean
      refundApplicationFee: boolean
    },
    key: string,
  ): Promise<RefundInfo> {
    if (this.refundShouldFail) throw new Error('Stripe API error (simulated refund failure)')
    return this.once(key, () => {
      const pi = this.intents.get(params.paymentIntentId)!
      const sums = this.sums.get(pi.id) ?? { refunded: 0, reversed: 0, feeRefunded: 0 }
      if (sums.refunded + params.amountCents > pi.amountReceivedCents)
        throw new Error('Refund amount is greater than the unrefunded amount')
      const id = `re_test_${++this.seq}`
      this.refunds.push({ id, params, key })
      sums.refunded += params.amountCents
      this.txn('refund', id, -params.amountCents)
      let reversal: string | null = null
      let feeTotal: number | null = null
      if (params.reverseTransfer) {
        reversal = `trr_test_${++this.seq}`
        sums.reversed += params.amountCents
        this.txn('transfer_refund', reversal, params.amountCents)
        this.credit(ACCT, -params.amountCents)
      }
      if (params.refundApplicationFee) {
        feeTotal = this.feeTotal(pi, sums.reversed)
        this.txn('application_fee_refund', `fr_${this.seq}`, -(feeTotal - sums.feeRefunded))
        this.credit(ACCT, feeTotal - sums.feeRefunded)
        sums.feeRefunded = feeTotal
      }
      this.sums.set(pi.id, sums)
      return {
        id,
        status: this.refundsPending ? 'pending' : 'succeeded',
        amountCents: params.amountCents,
        transferReversalId: reversal,
        applicationFeeRefundedTotalCents: feeTotal,
        failureReason: null,
      } satisfies RefundInfo
    })
  }
  async reverseTransfer(
    params: { chargeId: string; amountCents: number; refundApplicationFee: boolean },
    key: string,
  ) {
    return this.once(key, () => {
      const pi = [...this.intents.values()].find((i) => i.chargeId === params.chargeId)!
      const sums = this.sums.get(pi.id) ?? { refunded: 0, reversed: 0, feeRefunded: 0 }
      const id = `trr_test_${++this.seq}`
      sums.reversed += params.amountCents
      this.reversals.push({ id, chargeId: params.chargeId, amountCents: params.amountCents })
      this.txn('transfer_refund', id, params.amountCents)
      this.credit(ACCT, -params.amountCents)
      let feeTotal: number | null = null
      if (params.refundApplicationFee) {
        feeTotal = this.feeTotal(pi, sums.reversed)
        this.txn('application_fee_refund', `fr_${this.seq}`, -(feeTotal - sums.feeRefunded))
        this.credit(ACCT, feeTotal - sums.feeRefunded)
        sums.feeRefunded = feeTotal
      }
      this.sums.set(pi.id, sums)
      return { id, amountCents: params.amountCents, applicationFeeRefundedTotalCents: feeTotal }
    })
  }
  async createExpressAccount(_params: { merchantId: number; name: string }, key: string) {
    return this.once(key, () => {
      const id = `acct_test_${++this.seq}`
      this.accounts.set(id, { charges: false, payouts: false, available: 0, interval: 'daily' })
      return { id }
    })
  }
  /** Stripe test mode verifies a Custom account at once when given the documented test values. */
  customAccountRequests: Array<{ tosIp: string | null; tosUserAgent: string | null }> = []
  async createCustomAccount(
    params: { merchantId: number; name: string; tosIp: string | null; tosUserAgent: string | null },
    key: string,
  ) {
    return this.once(key, () => {
      this.customAccountRequests.push({ tosIp: params.tosIp, tosUserAgent: params.tosUserAgent })
      const id = `acct_test_${++this.seq}`
      this.accounts.set(id, { charges: true, payouts: true, available: 0, interval: 'daily' })
      return { id }
    })
  }
  async createOnboardingLink(accountId: string) {
    return `https://connect.stripe.test/setup/${accountId}`
  }
  /** The merchant finishes Stripe-hosted onboarding. */
  completeOnboarding(accountId: string) {
    const a = this.accounts.get(accountId)!
    a.charges = true
    a.payouts = true
  }
  async retrieveAccount(accountId: string) {
    const a = this.accounts.get(accountId)!
    return {
      id: accountId,
      chargesEnabled: a.charges,
      payoutsEnabled: a.payouts,
      disabledReason: a.charges ? null : 'requirements.past_due',
      currentlyDue: a.charges ? [] : ['external_account'],
    }
  }
  async retrieveBalance(accountId: string) {
    return { availableCents: this.accounts.get(accountId)?.available ?? 0, pendingCents: 0 }
  }
  async createPayout(accountId: string, amountCents: number, _m: unknown, key: string) {
    return this.once(key, () => {
      const a = this.accounts.get(accountId)!
      if (a.available < amountCents) throw new Error('insufficient funds')
      a.available -= amountCents
      const id = `po_test_${++this.seq}`
      this.payouts.push({ id, account: accountId, amountCents, key })
      return { id, status: 'pending' as const, arrivalDate: new Date(Date.now() + 2 * 86_400_000) }
    })
  }
  async updatePayoutSchedule(accountId: string, interval: string) {
    this.accounts.get(accountId)!.interval = interval
  }
  async listBalanceTransactions({ from, to }: { from: Date; to: Date }) {
    return this.balanceTxns.filter((t) => t.created >= from && t.created < to)
  }
  async submitDisputeEvidence(disputeId: string, evidence: Record<string, string>) {
    this.evidence.set(disputeId, evidence)
    return { status: 'under_review' }
  }
  /** A refund that had succeeded fails later (e.g. the card was closed): Stripe returns the money. */
  refundFails(refundId: string, amountCents: number) {
    this.txn('refund_failure', refundId, amountCents)
    return {
      id: refundId,
      object: 'refund',
      status: 'failed',
      failure_reason: 'expired_or_canceled_card',
    }
  }
  /** A won dispute: Stripe gives the disputed amount back to the platform. */
  reinstate(dispute: { id: string; amount: number; charge: unknown; payment_intent: unknown }) {
    this.txn('adjustment', dispute.id, dispute.amount)
    return { ...dispute, status: 'won' }
  }
  /** Stripe opens a dispute on a captured charge (the dispute test card, or a real chargeback). */
  dispute(piId: string, reason = 'fraudulent') {
    const pi = this.intents.get(piId)!
    const id = `dp_test_${++this.seq}`
    this.txn('adjustment', id, -pi.amountReceivedCents, 1500)
    return {
      id,
      object: 'dispute',
      amount: pi.amountReceivedCents,
      charge: pi.chargeId,
      payment_intent: pi.id,
      reason,
      status: 'needs_response',
      evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86_400 },
      balance_transactions: [{ fee: 1500 }],
    }
  }
}

// ---------------------------------------------------------------- harness
export let db: TestDb
export const stripe = new FakeStripe()
export const mail: Array<{ to: string; subject: string; text: string }> = []
export type Mods = {
  payments: typeof import('@/modules/payments')
  ordering: typeof import('@/modules/ordering')
  ops: typeof import('@/modules/ops')
  cart: typeof import('@/modules/cart')
  registry: typeof import('@/worker/registry')
  logger: typeof import('@/server/logger')
  stripeSdk: typeof import('@/modules/payments')
  fulfilment: typeof import('@/modules/fulfilment')
  scheduling: typeof import('@/modules/scheduling')
}
export let m: Mods
export const APP = '../../src/app/api'
export { sql }

export function setupIntegrationHarness(prefix: string): void {
  beforeAll(async () => {
    db = await createTestDb(prefix)
    // A merchant that can take test payments.
    await sql(
      db.adminUrl,
      `UPDATE merchant.merchants SET stripe_account_id = $1, charges_enabled = true,
       onboarding_status = 'verified' WHERE id = 1`,
      [ACCT],
    )
    process.env.CATALOG_DATABASE_URL = db.asRole('app_rw')
    process.env.STRIPE_WEBHOOKS_SIGNING_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_CARD_FEATURES = 'if_available'
    const { resetConfigForTests } = await import('@/server/config')
    resetConfigForTests()
    m = {
      payments: await import('@/modules/payments'),
      ordering: await import('@/modules/ordering'),
      ops: await import('@/modules/ops'),
      cart: await import('@/modules/cart'),
      registry: await import('@/worker/registry'),
      logger: await import('@/server/logger'),
      stripeSdk: await import('@/modules/payments'),
      fulfilment: await import('@/modules/fulfilment'),
      scheduling: await import('@/modules/scheduling'),
    }
    m.payments.setGatewayForTests(stripe)
    const { setMailerForTests } = await import('@/modules/notifications')
    setMailerForTests({
      send: async (msg) => {
        mail.push(msg)
        return { messageId: `msg-${mail.length}` }
      },
    })
  })

  afterAll(async () => {
    m?.payments.setGatewayForTests(undefined)
    const { closeDb } = await import('@/server/db')
    await closeDb()
    await db?.drop()
  })
}

let browserCount = 0

/** A tiny HTTP client over the route handlers, keeping the cart cookie like a browser. */
export class Browser {
  cookie = ''
  // A distinct client IP per browser, so per-IP rate limits never leak between tests.
  ip = `10.0.${Math.floor(browserCount / 250)}.${(browserCount++ % 250) + 1}`
  async call(
    method: string,
    routeFile: string,
    urlPath: string,
    body?: unknown,
    headers: Record<string, string> = {},
    params: Record<string, string> = {},
  ) {
    const mod = await import(`${APP}/${routeFile}/route.ts`)
    const req = new NextRequest(`http://localhost${urlPath}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': this.ip,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const res: Response = await mod[method](req, { params: Promise.resolve(params) })
    const set = res.headers.get('set-cookie')
    if (set?.startsWith('cart=')) this.cookie = set.split(';')[0]
    const json = await res.json()
    return { status: res.status, body: json, headers: res.headers }
  }
  add(productId: string, amount: { quantity?: number; weightLb?: number }, extra = {}) {
    return this.call('POST', 'v1/cart/items', '/api/v1/cart/items', {
      productId,
      ...amount,
      ...extra,
    })
  }
  quote() {
    return this.call('POST', 'v1/cart/quote', '/api/v1/cart/quote', {})
  }
  slotId: number | undefined
  /** The first pickup slot offered to this browser's cart (G4-03), remembered for replays. */
  async firstSlot(): Promise<number> {
    if (this.slotId === undefined) {
      const { body } = await this.call('GET', 'v1/cart/slots', '/api/v1/cart/slots')
      // No cart → no slots; any well-formed id lets the request reach the cart checks.
      this.slotId = body.slots[0]?.id ?? 999_999
    }
    return this.slotId!
  }
  async checkout(body: Record<string, unknown>, key?: string) {
    const withSlot = 'slotId' in body ? body : { ...body, slotId: await this.firstSlot() }
    return this.call(
      'POST',
      'v1/checkout',
      '/api/v1/checkout',
      withSlot,
      key ? { 'idempotency-key': key } : {},
    )
  }
}

export async function sendWebhook(event: Record<string, unknown>, route = 'webhooks/stripe') {
  const payload = JSON.stringify(event)
  const signature = m.stripeSdk.getStripe().webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  })
  const mod = await import(`${APP}/${route}/route.ts`)
  const req = new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  })
  const res: Response = await mod.POST(req, { params: Promise.resolve({}) })
  return { status: res.status, body: await res.json() }
}

let evt = 0
export const sessionEvent = (type: string, sessionId: string, orderId: number) => ({
  id: `evt_test_${++evt}`,
  object: 'event',
  type,
  livemode: false,
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-08-27.basil',
  data: {
    object: {
      id: sessionId,
      object: 'checkout.session',
      // Stripe echoes the session's metadata (incl. trace context, G6-08)
      metadata: { ...stripe.sessions.get(sessionId)!.params.metadata, order_id: String(orderId) },
      payment_intent: stripe.sessions.get(sessionId)!.pi,
    },
  },
})

/** Any Stripe event (refund, dispute, payout, account); `account` makes it a Connect event. */
export const stripeEvent = (type: string, object: Record<string, unknown>, account?: string) => ({
  id: `evt_test_${++evt}`,
  object: 'event',
  type,
  livemode: false,
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-08-27.basil',
  ...(account ? { account } : {}),
  data: { object },
})

/** Runs worker ticks until there's nothing left to do. */
export async function drainWorker() {
  const log = m.logger.getLogger()
  for (let i = 0; i < 50; i++) {
    const ran = await m.registry.runOnce('test-worker', log)
    const { rows } = await sql(
      db.adminUrl,
      `SELECT (SELECT count(*) FROM ops.outbox WHERE published_at IS NULL)::int AS outbox,
              (SELECT count(*) FROM ops.jobs WHERE status = 'queued' AND run_at <= now()
                AND queue = ANY($1::text[]))::int AS jobs`,
      [Object.keys(m.registry.HANDLERS)],
    )
    if (ran === 0 && rows[0].outbox === 0 && rows[0].jobs === 0) return
  }
  const { rows } = await sql(
    db.adminUrl,
    `SELECT queue, status, attempts, last_error FROM ops.jobs WHERE status IN ('queued', 'running')`,
  )
  throw new Error(`worker did not go idle: ${JSON.stringify(rows)}`)
}

export const orderRow = async (publicId: string) =>
  (await sql(db.adminUrl, 'SELECT * FROM commerce.orders WHERE public_id = $1', [publicId])).rows[0]
