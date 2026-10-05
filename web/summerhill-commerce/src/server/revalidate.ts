import { getConfig } from './config'
import { getLogger } from './logger'
import { guardedFetch } from './outbound'
import { sign, unsign } from './signing'

/**
 * On-demand ISR (G3-13, ARC-cache). Storefront pages are cached with tags (`catalog`,
 * `product:<id>`) and a time-based fallback. The worker, a separate process, can't call Next's
 * revalidateTag itself, so it posts a signed request to /api/webhooks/revalidate.
 */
export const CATALOG_TAG = 'catalog'
export const productTag = (id: string) => `product:${id}`
/** Fallback: cached catalogue pages are at most this old even if a revalidation was missed. */
export const CATALOG_REVALIDATE_SECONDS = 300

const MAX_AGE_MS = 5 * 60_000
const TAG = /^[a-z]+(:[A-Za-z0-9_-]{1,100})?$/

export function signRevalidation(tags: string[], now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ tags, ts: now })).toString('base64url')
  return sign('revalidate', payload)
}

/** Returns the tags when the signature is valid, fresh and every tag is well-formed; else null. */
export function verifyRevalidation(signed: unknown, now = Date.now()): string[] | null {
  if (typeof signed !== 'string') return null
  const payload = unsign('revalidate', signed)
  if (!payload) return null
  try {
    const { tags, ts } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof ts !== 'number' || Math.abs(now - ts) > MAX_AGE_MS) return null
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > 50) return null
    if (!tags.every((t) => typeof t === 'string' && TAG.test(t))) return null
    return tags
  } catch {
    return null
  }
}

/**
 * Asks the web app to revalidate `tags`. Best effort: if the app isn't running, cached pages still
 * expire after CATALOG_REVALIDATE_SECONDS, so the job doesn't fail (returns false).
 */
export async function requestRevalidation(tags: string[]): Promise<boolean> {
  try {
    // Through the outbound guard (G6-05); revalidating twice is harmless, so it may retry.
    const res = await guardedFetch('revalidate', () => true)(
      new URL('/api/webhooks/revalidate', getConfig().NEXT_PUBLIC_SERVER_URL),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: signRevalidation(tags) }),
      },
    )
    if (!res.ok) getLogger().warn({ tags, status: res.status }, 'revalidation request rejected')
    return res.ok
  } catch (err) {
    getLogger().warn({ tags, err }, 'revalidation request failed; pages refresh on their timer')
    return false
  }
}
