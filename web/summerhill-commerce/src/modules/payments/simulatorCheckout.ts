import { randomBytes } from 'node:crypto'

import type Stripe from 'stripe'

import { withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { getSimSession, saveSimIntent, saveSimSession, type SimSession } from './simulator'
import type { SimIntent } from './simulatorBackOffice'
import { STRIPE_API_VERSION } from './stripe'
import { recordWebhookEvent } from './webhooks'

/**
 * The simulator's hosted payment page (G4-18): what happens when the customer submits a card on
 * /simulator/checkout/{id}. Follows Stripe's documented test cards, so the same numbers work here
 * and on real Stripe test mode:
 *   4242 4242 4242 4242   succeeds
 *   4000 0000 0000 0002   declined (generic_decline)
 *   4000 0000 0000 9995   declined (insufficient_funds)
 *   4000 0027 6000 3184   3-D Secure required: the customer completes or fails the challenge
 *   4000 0000 0000 0259   succeeds; the charge is disputed as fraudulent once captured (G5-06)
 * On success the session completes, the PaymentIntent is authorised (manual capture), and a
 * `checkout.session.completed` event goes into the same webhook store Stripe's events use, so the
 * worker places the order exactly as it would for Stripe.
 */
export type SimAction =
  { action: 'pay'; cardNumber: string } | { action: 'complete_3ds' } | { action: 'fail_3ds' }

export type SimOutcome =
  | { outcome: 'succeeded'; redirectUrl: string }
  | { outcome: 'declined'; message: string }
  | { outcome: 'requires_action' }
  | { outcome: 'authentication_failed'; message: string }

const CARDS: Record<
  string,
  'success' | 'dispute' | 'generic_decline' | 'insufficient_funds' | '3ds'
> = {
  '4242424242424242': 'success',
  '4000000000000259': 'dispute',
  '4000000000000002': 'generic_decline',
  '4000000000009995': 'insufficient_funds',
  '4000002760003184': '3ds',
  '4000002500003155': '3ds',
}

export async function simulateCheckout(sessionId: string, input: SimAction): Promise<SimOutcome> {
  const result = await withTransaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sessionId])
    const session = await getSimSession(sessionId, tx)
    if (!session) throw new HttpError(404, 'NOT_FOUND', 'No such checkout session')
    if (session.status === 'complete')
      return { outcome: 'succeeded', redirectUrl: session.params.success_url! } as const
    if (session.status === 'expired' || new Date(session.expiresAt) < new Date())
      throw new HttpError(410, 'SESSION_EXPIRED', 'This checkout session has expired')

    if (input.action === 'fail_3ds') {
      if (!session.challenge) throw new HttpError(409, 'NO_CHALLENGE', 'No authentication pending')
      await saveSimSession(tx, { ...session, challenge: null })
      return {
        outcome: 'authentication_failed',
        message:
          'We are unable to authenticate your payment method. Please choose a different one.',
      } as const
    }
    if (input.action === 'complete_3ds') {
      if (!session.challenge) throw new HttpError(409, 'NO_CHALLENGE', 'No authentication pending')
      return authorize(tx, session)
    }

    const card = input.cardNumber.replace(/\s/g, '')
    const behaviour = CARDS[card]
    if (!behaviour)
      return {
        outcome: 'declined',
        message: 'Use a Stripe test card, e.g. 4242 4242 4242 4242 (this is a simulator).',
      } as const
    if (behaviour === 'generic_decline')
      return {
        outcome: 'declined',
        message: 'Your card was declined.',
        event: declineEvent(session, 'generic_decline'),
      } as const
    if (behaviour === 'insufficient_funds')
      return {
        outcome: 'declined',
        message: 'Your card has insufficient funds.',
        event: declineEvent(session, 'insufficient_funds'),
      } as const
    if (behaviour === '3ds') {
      await saveSimSession(tx, { ...session, challenge: card })
      return { outcome: 'requires_action' } as const
    }
    return authorize(tx, session, behaviour === 'dispute' ? 'fraudulent' : null)
  })
  if (result.outcome === 'succeeded' && 'event' in result && result.event) {
    await recordWebhookEvent(result.event, 'platform')
    return { outcome: 'succeeded', redirectUrl: result.redirectUrl }
  }
  // Like Stripe, every declined attempt is reported (the card-testing alert counts them, G6-09).
  if (result.outcome === 'declined' && 'event' in result && result.event) {
    await recordWebhookEvent(result.event, 'platform')
    return { outcome: 'declined', message: result.message }
  }
  return result as SimOutcome
}

/** Stripe's `payment_intent.payment_failed` for a declined attempt. */
function declineEvent(session: SimSession, declineCode: string): Stripe.Event {
  return {
    id: `evt_sim_${randomBytes(12).toString('hex')}`,
    object: 'event',
    type: 'payment_intent.payment_failed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: STRIPE_API_VERSION,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: session.paymentIntentId,
        object: 'payment_intent',
        status: 'requires_payment_method',
        metadata: session.params.metadata ?? {},
        last_payment_error: {
          type: 'card_error',
          code: 'card_declined',
          decline_code: declineCode,
        },
      },
    },
  } as unknown as Stripe.Event
}

async function authorize(
  tx: Parameters<typeof saveSimSession>[0],
  session: SimSession,
  disputeReason: string | null = null,
) {
  const now = Date.now()
  const pi: SimIntent = {
    id: session.paymentIntentId,
    status: 'requires_capture',
    amountCapturableCents: session.amountCents,
    amountReceivedCents: 0,
    applicationFeeCents: session.params.payment_intent_data?.application_fee_amount ?? null,
    chargeId: `ch_sim_${randomBytes(12).toString('hex')}`,
    captureBefore: new Date(now + 7 * 86_400_000),
    overcaptureStatus: 'unavailable',
    overcaptureMaximumCents: null,
    incrementalAuthorizationStatus: 'unavailable',
    extendedAuthorizationStatus: 'disabled',
    processingFeeCents: null,
    destination: session.params.payment_intent_data?.transfer_data?.destination ?? null,
    disputeReason,
  }
  await saveSimIntent(tx, pi)
  await saveSimSession(tx, { ...session, status: 'complete', challenge: null })
  const event = {
    id: `evt_sim_${randomBytes(12).toString('hex')}`,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(now / 1000),
    api_version: STRIPE_API_VERSION,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: session.id,
        object: 'checkout.session',
        metadata: session.params.metadata ?? {},
        payment_intent: session.paymentIntentId,
        payment_status: 'unpaid',
        status: 'complete',
      },
    },
  } as unknown as Stripe.Event
  return { outcome: 'succeeded' as const, redirectUrl: session.params.success_url!, event }
}

/** What the payment page shows: amounts and lines, never anything the customer can't see. */
export async function simulatedCheckoutView(sessionId: string) {
  const s = await getSimSession(sessionId)
  if (!s) return null
  return {
    id: s.id,
    status: s.status,
    expired: s.status === 'expired' || new Date(s.expiresAt) < new Date(),
    challenge: s.challenge !== null,
    amountCents: s.amountCents,
    email: s.params.customer_email ?? null,
    description: s.params.payment_intent_data?.description ?? null,
    lines: (s.params.line_items ?? []).map((l) => ({
      name: (l.price_data?.product_data as { name?: string } | undefined)?.name ?? 'Item',
      quantity: l.quantity ?? 1,
      amountCents: (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1),
    })),
    submitMessage: (s.params.custom_text?.submit || null)?.message ?? null,
    cancelUrl: s.params.cancel_url ?? null,
  }
}
