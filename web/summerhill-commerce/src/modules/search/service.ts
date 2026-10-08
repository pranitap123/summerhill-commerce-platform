import { getProductsByIds } from '@/modules/catalog'
import { getLogger } from '@/server/logger'

import { logSearch } from './analytics'
import { elasticSearch } from './elastic'
import { postgresSearch } from './postgres'
import type { CatalogPage, CatalogQuery, SearchEngine } from './types'

export async function findProducts(
  query: CatalogQuery,
  options: { log?: boolean } = {},
): Promise<CatalogPage> {
  const started = performance.now()
  const text = query.q?.trim()
  let engine: SearchEngine = 'postgres'
  let result
  if (text) {
    try {
      result = await elasticSearch({ ...query, q: text })
      engine = 'elasticsearch'
    } catch (err) {
      getLogger().warn({ err }, 'search: Elasticsearch unavailable, using the Postgres fallback')
    }
  }
  result ??= await postgresSearch({ ...query, q: text || undefined })
  const products = await getProductsByIds(result.ids)

  const items = products.filter((p) => p.isVisible)
  const tookMs = Math.round(performance.now() - started)

  let searchId: string | null = null
  if (text && options.log !== false) {
    const { q: _q, page: _p, limit: _l, ...filters } = query
    searchId = await logSearch({
      query: text,
      resultCount: result.total,
      engine,
      filters,
      tookMs,
    }).catch((err) => {
      getLogger().warn({ err }, 'search: analytics write failed')
      return null
    })
  }
  return {
    engine,
    total: result.total,
    page: query.page,
    limit: query.limit,
    items,
    facets: result.facets,
    searchId,
    tookMs,
  }
}
