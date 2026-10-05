import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import type { PaymentIntentInfo } from './gateway'

export type PaymentStatus =
  'pending' | 'requires_capture' | 'captured' | 'canceled' | 'expired' | 'failed'

export interface Payment {
  id: number
  orderId: number
  checkoutSessionId: string | null
  checkoutUrl: string | null
  paymentIntentId: string | null
  chargeId: string | null
  status: PaymentStatus
  amountAuthorizedCents: number | null
  amountCapturedCents: number | null
  applicationFeeCents: number | null
  processingFeeCents: number | null
  captureBefore: Date | null
  overcaptureStatus: string | null
  overcaptureMaximumCents: number | null
  incrementalAuthorizationStatus: string | null
  extendedAuthorizationStatus: string | null
  captureAttempts: number
  lastError: string | null
  createdAt: Date
}

type Row = Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
function toPayment(r: Row): Payment {
  return {
    id: Number(r.id),
    orderId: Number(r.order_id),
    checkoutSessionId: (r.checkout_session_id as string) ?? null,
    checkoutUrl: (r.checkout_url as string) ?? null,
    paymentIntentId: (r.payment_intent_id as string) ?? null,
    chargeId: (r.charge_id as string) ?? null,
    status: r.status as PaymentStatus,
    amountAuthorizedCents: n(r.amount_authorized_cents),
    amountCapturedCents: n(r.amount_captured_cents),
    applicationFeeCents: n(r.application_fee_cents),
    processingFeeCents: n(r.processing_fee_cents),
    captureBefore: (r.capture_before as Date) ?? null,
    overcaptureStatus: (r.overcapture_status as string) ?? null,
    overcaptureMaximumCents: n(r.overcapture_maximum_cents),
    incrementalAuthorizationStatus: (r.incremental_authorization_status as string) ?? null,
    extendedAuthorizationStatus: (r.extended_authorization_status as string) ?? null,
    captureAttempts: Number(r.capture_attempts),
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as Date,
  }
}

export async function insertPayment(tx: Db, orderId: number): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO finance.payments (order_id) VALUES ($1) RETURNING id',
    [orderId],
  )
  return Number(rows[0].id)
}

export async function setCheckoutSession(
  db: Db,
  paymentId: number,
  sessionId: string,
  url: string | null,
): Promise<void> {
  await db.query(
    'UPDATE finance.payments SET checkout_session_id = $2, checkout_url = $3 WHERE id = $1',
    [paymentId, sessionId, url],
  )
}

/** The order's current payment (the newest one). */
export async function getPaymentForOrder(
  orderId: number,
  db: Db = getDb(),
): Promise<Payment | null> {
  const { rows } = await db.query(
    'SELECT * FROM finance.payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1',
    [orderId],
  )
  return rows[0] ? toPayment(rows[0]) : null
}

export async function getPaymentByIntent(
  paymentIntentId: string,
  db: Db = getDb(),
): Promise<Payment | null> {
  const { rows } = await db.query('SELECT * FROM finance.payments WHERE payment_intent_id = $1', [
    paymentIntentId,
  ])
  return rows[0] ? toPayment(rows[0]) : null
}

function featureValues(pi: PaymentIntentInfo) {
  return [
    pi.chargeId,
    pi.captureBefore,
    pi.overcaptureStatus,
    pi.overcaptureMaximumCents,
    pi.incrementalAuthorizationStatus,
    pi.extendedAuthorizationStatus,
  ]
}

/** Card authorised: store the amount and the card-network feature statuses (PAYMENTS §3). */
export async function markAuthorized(
  tx: Db,
  paymentId: number,
  pi: PaymentIntentInfo,
): Promise<void> {
  await tx.query(
    `UPDATE finance.payments SET status = 'requires_capture', payment_intent_id = $2,
       amount_authorized_cents = $3, charge_id = $4, capture_before = $5, overcapture_status = $6,
       overcapture_maximum_cents = $7, incremental_authorization_status = $8,
       extended_authorization_status = $9, authorized_at = COALESCE(authorized_at, now())
     WHERE id = $1`,
    [paymentId, pi.id, pi.amountCapturableCents, ...featureValues(pi)],
  )
}

export async function markCaptured(
  tx: Db,
  paymentId: number,
  pi: PaymentIntentInfo,
  applicationFeeCents: number,
): Promise<void> {
  await tx.query(
    `UPDATE finance.payments SET status = 'captured', amount_captured_cents = $2,
       application_fee_cents = $3, processing_fee_cents = $4, captured_at = now(), last_error = NULL
     WHERE id = $1`,
    [paymentId, pi.amountReceivedCents, applicationFeeCents, pi.processingFeeCents],
  )
}

export async function setPaymentStatus(
  db: Db,
  paymentId: number,
  status: 'canceled' | 'expired' | 'failed',
): Promise<void> {
  await db.query(
    `UPDATE finance.payments SET status = $2,
       canceled_at = CASE WHEN $2 = 'canceled' THEN now() ELSE canceled_at END
     WHERE id = $1`,
    [paymentId, status],
  )
}

export async function recordCaptureAttempt(paymentId: number, error: string | null): Promise<void> {
  await getDb().query(
    `UPDATE finance.payments SET capture_attempts = capture_attempts + 1, last_error = $2
     WHERE id = $1`,
    [paymentId, error],
  )
}
