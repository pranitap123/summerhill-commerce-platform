import { consume, LIMITS } from '@/modules/ops'
import { findProducts } from '@/modules/search'
import { clientIp, parseQuery, route } from '@/server/http'

import { searchQuery } from '../_lib/schemas'

/**
 * GET /api/v1/search: text search with typo tolerance, prefixes and synonyms, plus the same
 * filters and facets as browsing (G3-08, G3-09). Elasticsearch, with a Postgres fallback; the
 * response says which engine answered. Logged for analytics without personal data (G3-15).
 */
export const GET = route('public', async ({ req }) => {
  const query = parseQuery(req, searchQuery)
  await consume(LIMITS.search, `ip:${clientIp(req) ?? 'unknown'}`)
  return findProducts(query)
})
