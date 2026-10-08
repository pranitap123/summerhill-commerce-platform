import { route } from '@/server/http'

import { receiveStripeWebhook } from '../_lib/stripeWebhook'

export const POST = route('webhook', ({ req, log }) => receiveStripeWebhook(req, 'platform', log))
