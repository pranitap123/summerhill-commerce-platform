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

export async function replayWebhookEvent(eventId: string, actor: Actor) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      'SELECT status FROM ops.webhook_events WHERE event_id = $1 FOR UPDATE',
      [eventId],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', `No stored webhook event ${eventId}`)
    if (rows[0].status !== 'failed' && rows[0].status !== 'pending')
      throw new HttpError(409, 'ALREADY_PROCESSED', `Event ${eventId} is already ${rows[0].status}`)

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

    case 'payment_intent.payment_failed':
      return 'ignored'
    case 'account.updated':
      return accountUpdated(event.data.object)

    case 'refund.updated':
    case 'refund.failed':
    case 'charge.refund.updated':
      return onRefundEvent(event.data.object as Stripe.Refund)

    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
      return onDisputeEvent(event.type, event.data.object as unknown as StripeDisputeLike)
    case 'charge.dispute.funds_reinstated':
      return onDisputeFundsReinstated(event.data.object as unknown as StripeDisputeLike)

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
    if (order?.status !== 'pending_payment') return
    const payment = await getPaymentForOrder(orderId, tx)
    if (payment) await setPaymentStatus(tx, payment.id, 'expired')

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
