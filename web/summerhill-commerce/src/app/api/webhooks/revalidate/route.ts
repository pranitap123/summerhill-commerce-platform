import { revalidateTag } from 'next/cache'

import { HttpError, route } from '@/server/http'
import { verifyRevalidation } from '@/server/revalidate'

/**
 * POST /api/webhooks/revalidate: on-demand ISR from the worker (G3-13). No session; the body must
 * carry a payload signed with the `revalidate` key and at most 5 minutes old.
 */
export const POST = route('webhook', async ({ req, log }) => {
  const body = (await req.json().catch(() => null)) as { payload?: unknown } | null
  const tags = verifyRevalidation(body?.payload)
  if (!tags)
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Invalid or expired revalidation request')
  for (const tag of tags) revalidateTag(tag, 'max')
  log.info({ tags }, 'revalidated')
  return { revalidated: tags }
})
