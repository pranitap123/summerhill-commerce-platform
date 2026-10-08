import { revalidateTag } from 'next/cache'

import { HttpError, route } from '@/server/http'
import { verifyRevalidation } from '@/server/revalidate'

export const POST = route('webhook', async ({ req, log }) => {
  const body = (await req.json().catch(() => null)) as { payload?: unknown } | null
  const tags = verifyRevalidation(body?.payload)
  if (!tags)
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Invalid or expired revalidation request')
  for (const tag of tags) revalidateTag(tag, 'max')
  log.info({ tags }, 'revalidated')
  return { revalidated: tags }
})
