import Stripe from 'stripe'

import { getConfig } from '@/server/config'
import { guardedFetch } from '@/server/outbound'

export const STRIPE_API_VERSION = '2025-08-27.basil' as const

let client: Stripe | undefined

const stripeIdempotent = (method: string, headers: Headers) =>
  method === 'GET' || method === 'DELETE' || headers.has('idempotency-key')

export function getStripe(): Stripe {
  client ??= createStripeClient(getConfig().STRIPE_SECRET_KEY)
  return client
}

export function createStripeClient(key: string, overrides: Stripe.StripeConfig = {}): Stripe {
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(guardedFetch('stripe', stripeIdempotent)),
    maxNetworkRetries: 0,
    timeout: 30_000,
    ...overrides,
  })
}
