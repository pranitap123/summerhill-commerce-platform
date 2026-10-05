import { randomBytes } from 'node:crypto'

import type Stripe from 'stripe'

import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'

import type { CheckoutSessionInfo, PaymentGateway, PaymentIntentInfo } from './gateway'
import {
  afterSimulatedCapture,
  announceDispute,
  simulatedBackOffice,
  type SimDispute,
  type SimIntent,
} from './simulatorBackOffice'

/**
 * Payment simulator (G4-18): a PaymentGateway that behaves like Stripe in test mode, for the
 * end-to-end tests and for demos without a Stripe account (PAYMENT_PROVIDER=simulator; refused in
 * production by the config). Checkout Sessions and PaymentIntents live in ops.payment_simulator,
 * so the web app and the worker share them. The hosted payment page is /simulator/checkout/{id}
 * (see ./simulatorCheckout.ts), which reacts to Stripe's documented test cards.
 *
 * Only what the order flow uses is modelled: manual capture, capture of a lower or equal amount,
 * void, idempotency keys, and the card-feature fields the capture job reads.
 */
export interface SimSession {
  id: string
  status: 'open' | 'complete' | 'expired'
  paymentIntentId: string
  url: string
  expiresAt: string
  amountCents: number
  params: Stripe.Checkout.SessionCreateParams
  /** A 3-D Secure challenge is showing for this card. */
  challenge: string | null
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

export async function getSimSession(id: string, db: Db = getDb()): Promise<SimSession | null> {
  return /^cs_sim_[0-9a-f]{24}$/.test(id) ? load<SimSession>(db, id) : null
}
export async function saveSimSession(db: Db, s: SimSession): Promise<void> {
  await save(db, 'checkout_session', s.id, s)
}
export async function getSimIntent(id: string, db: Db = getDb()): Promise<PaymentIntentInfo> {
  const pi = await load<PaymentIntentInfo>(db, id)
  if (!pi) throw new Error(`No such payment_intent: '${id}' (simulator)`)
  return reviveIntent(pi)
}
export async function saveSimIntent(db: Db, pi: PaymentIntentInfo): Promise<void> {
  await save(db, 'payment_intent', pi.id, pi)
}

/** Dates come back from JSON as strings. */
function reviveIntent(pi: PaymentIntentInfo): PaymentIntentInfo {
  return { ...pi, captureBefore: pi.captureBefore ? new Date(pi.captureBefore) : null }
}

/** Runs `fn` once per idempotency key and replays its result afterwards (like Stripe). */
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

export function simulatedGateway(serverUrl: string): PaymentGateway {
  return {
    ...simulatedBackOffice(serverUrl),
    async createCheckoutSession(params, idempotencyKey): Promise<CheckoutSessionInfo> {
      const s = await idempotent(`checkout:${idempotencyKey}`, async (tx) => {
        const id = newId('cs')
        const session: SimSession = {
          id,
          status: 'open',
          paymentIntentId: newId('pi'),
          url: `${serverUrl}/simulator/checkout/${id}`,
          expiresAt: new Date((params.expires_at ?? Date.now() / 1000 + 1800) * 1000).toISOString(),
          amountCents: (params.line_items ?? []).reduce(
            (sum, l) => sum + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1),
            0,
          ),
          params,
          challenge: null,
        }
        await saveSimSession(tx, session)
        return session
      })
      return { id: s.id, url: s.url, expiresAt: new Date(s.expiresAt) }
    },

    async expireCheckoutSession(id) {
      return withTransaction(async (tx) => {
        const s = await load<SimSession>(tx, id, true)
        if (!s) throw new Error(`No such checkout.session: '${id}' (simulator)`)
        if (s.status === 'complete') return 'complete'
        if (s.status === 'expired') return 'already_expired'
        await saveSimSession(tx, { ...s, status: 'expired' })
        return 'expired'
      })
    },

    retrievePaymentIntent: (id) => getSimIntent(id),

    async capturePaymentIntent(id, amounts, idempotencyKey) {
      let dispute: SimDispute | null = null
      const result = await idempotent(`capture:${idempotencyKey}`, async (tx) => {
        const pi = reviveIntent((await load<SimIntent>(tx, id, true))!) as SimIntent
        if (pi.status !== 'requires_capture')
          throw new Error(
            `This PaymentIntent could not be captured because it has a status of ${pi.status}.`,
          )
        const max = Math.max(pi.amountCapturableCents, pi.overcaptureMaximumCents ?? 0)
        if (amounts.amountToCaptureCents > max)
          throw new Error('amount_to_capture is greater than the amount capturable (simulator)')
        const captured: SimIntent = {
          ...pi,
          status: 'succeeded',
          amountCapturableCents: 0,
          amountReceivedCents: amounts.amountToCaptureCents,
          applicationFeeCents: amounts.applicationFeeCents,
          // Stripe's standard Canadian card pricing: 2.9% + 30¢
          processingFeeCents: Math.round(amounts.amountToCaptureCents * 0.029) + 30,
        }
        await saveSimIntent(tx, captured)
        dispute = await afterSimulatedCapture(tx, captured)
        return captured
      })
      if (dispute) await announceDispute(dispute)
      return reviveIntent(result)
    },

    async cancelPaymentIntent(id, idempotencyKey) {
      return idempotent(`cancel:${idempotencyKey}`, async (tx) => {
        const pi = reviveIntent((await load<PaymentIntentInfo>(tx, id, true))!)
        if (pi.status === 'canceled') return pi
        const canceled: PaymentIntentInfo = { ...pi, status: 'canceled', amountCapturableCents: 0 }
        await saveSimIntent(tx, canceled)
        return canceled
      })
    },
  }
}
