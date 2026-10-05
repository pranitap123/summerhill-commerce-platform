import { route } from '@/server/http'

import { receiveStripeWebhook } from '../_lib/stripeWebhook'

/** Connect events from merchant accounts (account.updated, G2-11). Signature-verified. */
export const POST = route('webhook', ({ req, log }) => receiveStripeWebhook(req, 'connect', log))
