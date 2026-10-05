import type Stripe from 'stripe'

import {
  deriveOnboardingStatus,
  getMerchantByStripeAccount,
  updateMerchantStatus,
} from '@/modules/merchant'
import { audit, enqueue, raiseAlert, type Actor } from '@/modules/ops'
import { getOrder, getOrderForUpdate, transitionInTx, VOIDABLE_STATUSES } from '@/modules/ordering'
import { getDb, withTransaction } from '@/server/db'
import { inSpan, SpanKind } from '@/server/tracing'
import { HttpError } from '@/server/http'
import { getLogger } from '@/server/logger'

import { recordAuthorization } from './capture'
import { onDisputeEvent, onDisputeFundsReinstated, type StripeDisputeLike } from './disputes'
import { onRefundEvent } from './refunds'
import { getGateway } from './gateway'
import { getPaymentByIntent, getPaymentForOrder, setPaymentStatus } from './repository'

/**
 * Stripe webhooks (G2-08). The HTTP handler only verifies the signature and calls
 * `recordWebhookEvent`, which stores the event and enqueues `stripe.webhook.process` in one
 * transaction, then answers 200 fast. The worker processes it:
 *  - duplicates are harmless: event_id is unique, and every handler is guarded by the order state
 *  - out-of-order events are harmless: handlers act only from the state they expect, and read the
 *    PaymentIntent from Stripe rather than trusting the event's snapshot
 */
export const WEBHOOK_QUEUE = 'stripe.webhook.process'

export type WebhookSource = 'platform' | 'connect'

export async function recordWebhookEvent(
  event: Stripe.Event,
  source: WebhookSource,
): Promise<'recorded' | 'duplicate'> {
  return withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `INSERT INTO ops.webhook_events
         (event_id, source, type, account, livemode, api_version, stripe_created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        source,
        event.type,
        event.account ?? null,
        event.livemode,
        event.api_version,
        event.created,
        JSON.stringify(event),
      ],
    )
    if (!rowCount) return 'duplicate'
    await enqueue(
      tx,
      WEBHOOK_QUEUE,
      { eventId: event.id },
      { dedupeKey: event.id, maxAttempts: 10 },
    )
    return 'recorded'
  })
}

type Outcome = 'processed' | 'ignored'

export async function processWebhookEvent(eventId: string): Promise<Outcome | 'already_done'> {
  const { rows } = await getDb().query<{ status: string; payload: Stripe.Event }>(
    'SELECT status, payload FROM ops.webhook_events WHERE event_id = $1',
    [eventId],
  )
  const row = rows[0]
  if (!row) throw new Error(`webhook event ${eventId} not found`)
  if (row.status === 'processed' || row.status === 'ignored') return 'already_done'
  const event = row.payload
  const object = event.data.object as { metadata?: Record<string, string> | null }
  try {
    const outcome = await inSpan(
      `stripe.webhook ${event.type}`,
      {
        kind: SpanKind.CONSUMER,
        parent: object.metadata?.traceparent
          ? { traceparent: object.metadata.traceparent, tracestate: object.metadata.tracestate }
          : null,
        attributes: { 'stripe.event_id': event.id, 'stripe.event_type': event.type },
      },
      () => dispatch(event),
    )
    await getDb().query(
      `UPDATE ops.webhook_events SET status = $2, processed_at = now(), attempts = attempts + 1,
         last_error = NULL WHERE event_id = $1`,
      [eventId, outcome],
    )
    return outcome
  } catch (err) {
    await getDb().query(
      `UPDATE ops.webhook_events SET attempts = attempts + 1, last_error = $2 WHERE event_id = $1`,
      [eventId, err instanceof Error ? err.message : String(err)],
    )
    throw err
  }
}

/** Dead-lettered webhook: mark it failed and alert. */
export async function onWebhookDead(eventId: string, error: string): Promise<void> {
  await getDb().query(`UPDATE ops.webhook_events SET status = 'failed' WHERE event_id = $1`, [
    eventId,
  ])
  await raiseAlert(getDb(), {
    kind: 'webhook.failed',
    dedupeKey: `webhook-failed:${eventId}`,
    severity: 'critical',
    message: `Stripe webhook ${eventId} failed permanently`,
    data: { eventId, error },
  })
}

/**
 * Runbook RB-03: process a stored event again after the cause of its failure is fixed. Only a
 * failed (dead-lettered) or still-pending event can be replayed; handlers are guarded by order state,
 * so a replay never applies an event twice. An event Stripe sent but we never stored is re-sent from
 * Stripe instead (`stripe events resend`).
 */
export async function replayWebhookEvent(eventId: string, actor: Actor) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      'SELECT status FROM ops.webhook_events WHERE event_id = $1 FOR UPDATE',
      [eventId],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', `No stored webhook event ${eventId}`)
    if (rows[0].status !== 'failed' && rows[0].status !== 'pending')
      throw new HttpError(409, 'ALREADY_PROCESSED', `Event ${eventId} is already ${rows[0].status}`)
    // A pending event whose job is still queued or running belongs to the worker: don't race it.
    const live = await tx.query(
      `SELECT 1 FROM ops.jobs WHERE queue = $1 AND dedupe_key = $2 AND status IN ('queued', 'running')`,
      [WEBHOOK_QUEUE, eventId],
    )
    if (live.rowCount)
      throw new HttpError(409, 'IN_PROGRESS', `Event ${eventId} is still queued for the worker`)
    await tx.query(
      `UPDATE ops.webhook_events SET status = 'pending', last_error = NULL WHERE event_id = $1`,
      [eventId],
    )
    await audit(tx, {
      actor,
      action: 'webhook.replay',
      targetType: 'webhook_event',
      targetId: eventId,
      data: { previousStatus: rows[0].status },
    })
  }).then(() => processWebhookEvent(eventId))
}

async function dispatch(event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return sessionCompleted(event.data.object)
    case 'checkout.session.expired':
      return sessionExpired(event.data.object)
    case 'payment_intent.canceled':
      return paymentIntentCanceled(event.data.object)
    // G6-09: a declined attempt changes nothing (the customer can retry in Checkout); the stored
    // event feeds the card-testing alert rule.
    case 'payment_intent.payment_failed':
      return 'ignored'
    case 'account.updated':
      return accountUpdated(event.data.object)
    // G5-04: refunds are confirmed (or fail) asynchronously
    case 'refund.updated':
    case 'refund.failed':
    case 'charge.refund.updated':
      return onRefundEvent(event.data.object as Stripe.Refund)
    // G5-06: disputes
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
      return onDisputeEvent(event.type, event.data.object as unknown as StripeDisputeLike)
    case 'charge.dispute.funds_reinstated':
      return onDisputeFundsReinstated(event.data.object as unknown as StripeDisputeLike)
    // G5-07: merchant payouts (Connect events carry the connected account)
    case 'payout.created':
    case 'payout.updated':
    case 'payout.paid':
    case 'payout.failed':
    case 'payout.canceled': {
      const { onPayoutEvent } = await import('@/modules/payouts')
      return onPayoutEvent(event.account ?? null, event.data.object as Stripe.Payout)
    }
    default:
      return 'ignored'
  }
}

function orderIdOf(session: Stripe.Checkout.Session): number | null {
  const id = Number(session.metadata?.order_id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function sessionCompleted(session: Stripe.Checkout.Session): Promise<Outcome> {
  const orderId = orderIdOf(session)
  const piId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (!orderId || !piId) {
    getLogger().warn({ sessionId: session.id }, 'checkout session without order metadata ignored')
    return 'ignored'
  }
  // The event is a snapshot; the PaymentIntent from Stripe is the truth.
  const pi = await getGateway().retrievePaymentIntent(piId)
  if (pi.status === 'requires_capture') {
    await recordAuthorization(orderId, pi)
    return 'processed'
  }
  if (pi.status === 'canceled') return sessionExpired(session)
  throw new Error(`unexpected PaymentIntent status ${pi.status} for order ${orderId}`)
}

async function sessionExpired(session: Stripe.Checkout.Session): Promise<Outcome> {
  const orderId = orderIdOf(session)
  if (!orderId) return 'ignored'
  await withTransaction(async (tx) => {
    const order = await getOrderForUpdate(tx, orderId)
    if (order?.status !== 'pending_payment') return // already placed, abandoned or superseded
    const payment = await getPaymentForOrder(orderId, tx)
    if (payment) await setPaymentStatus(tx, payment.id, 'expired')
    // The transition releases the pickup-slot hold (G4-02).
    await transitionInTx(
      tx,
      orderId,
      'pending_payment',
      'abandoned',
      { type: 'stripe', id: session.id },
      {
        reason: 'checkout_session_expired',
      },
    )
  })
  return 'processed'
}

/** Stripe cancelled an authorisation we didn't (e.g. it expired after 7 days). */
async function paymentIntentCanceled(pi: Stripe.PaymentIntent): Promise<Outcome> {
  const payment = await getPaymentByIntent(pi.id)
  if (!payment || payment.status !== 'requires_capture') return 'ignored'
  const order = await getOrder(payment.orderId)
  await withTransaction(async (tx) => {
    await setPaymentStatus(tx, payment.id, 'canceled')
    if (order && VOIDABLE_STATUSES.includes(order.status))
      await transitionInTx(
        tx,
        order.id,
        order.status,
        'cancelled',
        { type: 'stripe', id: pi.id },
        {
          reason: `authorization_canceled:${pi.cancellation_reason ?? 'unknown'}`,
        },
      )
    await raiseAlert(tx, {
      kind: 'payment.authorization_canceled',
      dedupeKey: `auth-canceled:${pi.id}`,
      severity: 'critical',
      message: `Stripe cancelled the authorisation of order ${order?.publicId ?? payment.orderId}`,
      data: { orderId: payment.orderId, reason: pi.cancellation_reason },
    })
  })
  return 'processed'
}

/** G2-11: merchant onboarding status follows Connect `account.updated` (replaces polling). */
async function accountUpdated(account: Stripe.Account): Promise<Outcome> {
  const merchant = await getMerchantByStripeAccount(account.id)
  if (!merchant) return 'ignored'
  await updateMerchantStatus(merchant.id, {
    onboarding_status: deriveOnboardingStatus(account),
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    disabled_reason: account.requirements?.disabled_reason ?? null,
    requirements_due: account.requirements?.currently_due ?? [],
  })
  return 'processed'
}
