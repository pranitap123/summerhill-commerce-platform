import { getConfig } from './config'
import { getLogger } from './logger'
import { guardedFetch } from './outbound'
import { sign, unsign } from './signing'

export const CATALOG_TAG = 'catalog'
export const productTag = (id: string) => `product:${id}`

export const CATALOG_REVALIDATE_SECONDS = 300

const MAX_AGE_MS = 5 * 60_000
const TAG = /^[a-z]+(:[A-Za-z0-9_-]{1,100})?$/

export function signRevalidation(tags: string[], now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ tags, ts: now })).toString('base64url')
  return sign('revalidate', payload)
}

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

export async function requestRevalidation(tags: string[]): Promise<boolean> {
  try {
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
