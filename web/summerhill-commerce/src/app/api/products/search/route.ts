import { consume, LIMITS } from '@/modules/ops'
import { findProducts } from '@/modules/search'
import { clientIp, parseQuery, route } from '@/server/http'

import { searchQuery } from '../../v1/_lib/schemas'
import { deprecated } from '../deprecated'

export const GET = route('public', async ({ req }) => {
  const query = parseQuery(req, searchQuery)
  await consume(LIMITS.search, `ip:${clientIp(req) ?? 'unknown'}`)
  return deprecated(await findProducts(query), '/api/v1/search')
})
