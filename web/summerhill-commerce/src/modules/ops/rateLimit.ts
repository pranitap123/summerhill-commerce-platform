import type { Db } from '@/server/db'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Fixed-window rate limiter backed by Postgres (G2-16), so the limit holds across app instances.
 * `consume` counts one hit and throws 429 RATE_LIMITED (with Retry-After) past the limit.
 */
export interface RateLimit {
  name: string
  limit: number
  windowSeconds: number
}

export const LIMITS = {
  checkout: { name: 'checkout', limit: 10, windowSeconds: 60 },
  login: { name: 'login', limit: 10, windowSeconds: 300 },
  passwordReset: { name: 'password-reset', limit: 5, windowSeconds: 3600 },
  signup: { name: 'signup', limit: 5, windowSeconds: 3600 },
  orderLookup: { name: 'order-lookup', limit: 5, windowSeconds: 3600 },
  // Text search writes an analytics row per request (G3-15)
  search: { name: 'search', limit: 120, windowSeconds: 60 },
  // Staff MFA codes (G5-12): per user, so a stolen password can't brute-force the second factor
  mfa: { name: 'mfa', limit: 5, windowSeconds: 300 },
  // Admin money actions: refunds, payouts, recoveries (SECURITY §5)
  adminMoney: { name: 'admin-money', limit: 30, windowSeconds: 60 },
  // Support issues from customers (G5-11), per order
  issues: { name: 'issues', limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimit>

export async function consume(
  rule: RateLimit,
  subject: string,
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<{ count: number; remaining: number }> {
  const windowMs = rule.windowSeconds * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO ops.rate_limits (bucket, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = ops.rate_limits.count + 1
     RETURNING count`,
    [`${rule.name}:${subject}`, windowStart],
  )
  const count = rows[0].count
  if (count > rule.limit) {
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.', {
      retryAfterSeconds,
    })
  }
  return { count, remaining: rule.limit - count }
}

export async function purgeRateLimitWindows(db: Db = getDb()): Promise<void> {
  await db.query(`DELETE FROM ops.rate_limits WHERE window_start < now() - interval '1 day'`)
}
