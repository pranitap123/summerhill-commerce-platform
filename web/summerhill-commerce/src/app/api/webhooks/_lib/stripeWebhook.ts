import { NextResponse, type NextRequest } from 'next/server'

import { recordWebhookEvent, verifyWebhook, type WebhookSource } from '@/modules/payments'
import { getConfig } from '@/server/config'
import { HttpError } from '@/server/http'
import type { Logger } from '@/server/logger'

export async function receiveStripeWebhook(
  req: NextRequest,
  source: WebhookSource,
  log: Logger,
): Promise<Response> {
  const config = getConfig()
  const secret =
    source === 'connect'
      ? (config.STRIPE_CONNECT_WEBHOOKS_SIGNING_SECRET ?? config.STRIPE_WEBHOOKS_SIGNING_SECRET)
      : config.STRIPE_WEBHOOKS_SIGNING_SECRET
  if (!secret)
    throw new HttpError(503, 'WEBHOOKS_NOT_CONFIGURED', 'Webhook signing secret is not configured')
  const signature = req.headers.get('stripe-signature')
  if (!signature) throw new HttpError(400, 'SIGNATURE_MISSING', 'Missing Stripe-Signature header')

  const raw = await req.text()
  let event
  try {
    event = verifyWebhook(raw, signature, secret)
  } catch {
    throw new HttpError(400, 'SIGNATURE_INVALID', 'Invalid webhook signature')
  }
  if (event.livemode)
    throw new HttpError(400, 'LIVE_MODE_REJECTED', 'This deployment accepts test-mode events only')

  const outcome = await recordWebhookEvent(event, source)
  log.info({ eventId: event.id, type: event.type, outcome }, 'stripe webhook received')
  return NextResponse.json({ received: true, duplicate: outcome === 'duplicate' })
}
