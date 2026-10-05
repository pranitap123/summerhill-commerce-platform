import Stripe from 'stripe'

import { getConfig } from '@/server/config'
import { guardedFetch } from '@/server/outbound'

// Pinned on purpose: API upgrades are deliberate changes with a test run (PAYMENTS §11).
export const STRIPE_API_VERSION = '2025-08-27.basil' as const

let client: Stripe | undefined

/** Only reads and writes carrying an Idempotency-Key can be repeated safely (G6-05). */
const stripeIdempotent = (method: string, headers: Headers) =>
  method === 'GET' || method === 'DELETE' || headers.has('idempotency-key')

/**
 * The only Stripe SDK client in the app. Test-mode keys only (enforced by config). Requests go
 * through the outbound guard (G6-05): 10 s per attempt, retries with jitter for idempotent calls,
 * a circuit breaker. The SDK's own retries are off so a request isn't retried twice over; its
 * timeout is the budget for all attempts.
 */
export function getStripe(): Stripe {
  client ??= createStripeClient(getConfig().STRIPE_SECRET_KEY)
  return client
}

/** The client's settings; tests point `host`/`port` at a local fake to exercise the guard. */
export function createStripeClient(key: string, overrides: Stripe.StripeConfig = {}): Stripe {
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(guardedFetch('stripe', stripeIdempotent)),
    maxNetworkRetries: 0,
    timeout: 30_000,
    ...overrides,
  })
}
