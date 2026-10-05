import { route } from '@/server/http'

import { receiveStripeWebhook } from '../_lib/stripeWebhook'

/** Platform events (checkout sessions, payment intents). Signature-verified; no session. */
export const POST = route('webhook', ({ req, log }) => receiveStripeWebhook(req, 'platform', log))
