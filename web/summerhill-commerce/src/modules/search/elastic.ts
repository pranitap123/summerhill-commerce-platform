import { Client, UndiciConnection } from '@elastic/elasticsearch'
import type {
  ConnectionRequestOptions,
  ConnectionRequestParams,
  ConnectionRequestResponse,
  estypes,
} from '@elastic/elasticsearch'

import {
  allCatalogDocuments,
  changedProductIdsSince,
  getCatalogDocuments,
  type CatalogDocument,
} from '@/modules/catalog'
import { getConfig } from '@/server/config'
import { guard, resetGuardsForTests } from '@/server/outbound'

import { synonymRules } from './synonyms'
import type { CatalogQuery, EngineResult } from './types'

/**
 * Elasticsearch engine (ADR-0007, CATALOG §8). Queries go through an alias; the nightly rebuild
 * writes a fresh index, verifies the count and swaps the alias atomically, so a half-built index is
 * never served. Between rebuilds, `product.changed` events upsert single documents.
 */
let client: Client | undefined

/** Reads: safe to repeat. Writes (bulk, index admin) are tried once. */
const READ_PATH = /\/_(search|count|msearch|mget|cat|cluster\/health)(\/|$)|^\/$/

/**
 * Every request the client sends goes through the outbound guard (G6-05): per-attempt timeout
 * (the request's own `requestTimeout`), one retry with jitter for reads, and a circuit breaker, so
 * when Elasticsearch is down, search falls back to Postgres at once instead of timing out on
 * every query. The client's own retries are off: the guard does them.
 */
class GuardedConnection extends UndiciConnection {
  // The client also calls the streaming overload; the guard passes either result through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async request(params: ConnectionRequestParams, options: any): Promise<any> {
    const opts = options as ConnectionRequestOptions
    const idempotent =
      params.method === 'GET' || params.method === 'HEAD' || READ_PATH.test(params.path)
    return guard('elasticsearch').run(
      (signal) =>
        super.request(params, {
          ...opts,
          signal: opts.signal ? AbortSignal.any([opts.signal, signal]) : signal,
        }),
      {
        idempotent,
        timeoutMs: typeof opts.timeout === 'number' ? opts.timeout : undefined,
        failed: (res: ConnectionRequestResponse) => res.statusCode >= 500 || res.statusCode === 429,
      },
    )
  }
}

/**
 * Storefront reads get 3 s. The client's own default must be the LONGEST budget (index admin,
 * 30 s): the connection enforces the default at the socket level, so a per-request timeout can
 * only shorten it, never extend it (found in G6-05: the 30 s admin budget had never applied).
 */
export const QUERY_TIMEOUT = { requestTimeout: 3_000 }

export function getSearchClient(): Client {
  client ??= new Client({
    node: getConfig().ELASTICSEARCH_URL,
    requestTimeout: 30_000,
    maxRetries: 0,
    Connection: GuardedConnection,
  })
  return client
}

/** Test helper: forget the client (and its circuit) after changing ELASTICSEARCH_URL. */
export function resetSearchClientForTests(): void {
  client = undefined
  resetGuardsForTests('elasticsearch')
}

export const aliasName = () => getConfig().SEARCH_INDEX_ALIAS

const TEXT = (extra: Record<string, unknown> = {}) => ({
  type: 'text' as const,
  analyzer: 'en_index',
  search_analyzer: 'en_search',
  ...extra,
})
const WITH_PREFIX = {
  fields: {
    prefix: { type: 'text' as const, analyzer: 'prefix_index', search_analyzer: 'prefix_search' },
    exact: { type: 'keyword' as const, normalizer: 'lower' },
  },
}

export const INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    filter: {
      en_possessive: { type: 'stemmer', language: 'possessive_english' },
      en_stem: { type: 'stemmer', language: 'light_english' },
      en_synonyms: { type: 'synonym_graph', synonyms: synonymRules() },
      edge: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
    },
    analyzer: {
      en_index: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'en_possessive', 'en_stem'],
      },
      en_search: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'en_possessive', 'en_synonyms', 'en_stem'],
      },
      prefix_index: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'edge'],
      },
      prefix_search: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding'],
      },
    },
    normalizer: { lower: { type: 'custom', filter: ['lowercase', 'asciifolding'] } },
  },
}

export const INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'keyword' },
    slug: { type: 'keyword' },
    merchantId: { type: 'integer' },
    merchantSlug: { type: 'keyword' },
    name: TEXT(WITH_PREFIX),
    brand: TEXT(WITH_PREFIX),
    description: TEXT(),
    category: TEXT({ fields: { keyword: { type: 'keyword' } } }),
    categorySlug: { type: 'keyword' },
    subcategory: TEXT({ fields: { keyword: { type: 'keyword' } } }),
    subcategorySlug: { type: 'keyword' },
    organic: { type: 'boolean' },
    dietaryClaims: { type: 'keyword' },
    pricingModel: { type: 'keyword' },
    unit: { type: 'keyword' },
    effectivePriceCents: { type: 'integer' },
    onSale: { type: 'boolean' },
    taxCode: { type: 'keyword' },
    inStock: { type: 'boolean' },
    listed: { type: 'boolean' },
    hiddenUntil: { type: 'date' },
    popularity30d: { type: 'integer' },
    image: { type: 'keyword', index: false },
    updatedAt: { type: 'date' },
  },
}

// ---------------------------------------------------------------------------------- indexing

async function aliasTargets(): Promise<string[]> {
  const es = getSearchClient()
  if (!(await es.indices.existsAlias({ name: aliasName() }, QUERY_TIMEOUT))) return []
  return Object.keys(await es.indices.getAlias({ name: aliasName() }, QUERY_TIMEOUT))
}

export async function searchIndexExists(): Promise<boolean> {
  try {
    return (await aliasTargets()).length > 0
  } catch {
    return false
  }
}

async function bulkWrite(
  index: string,
  docs: CatalogDocument[],
  deletes: string[] = [],
  refresh: 'wait_for' | false = false,
) {
  if (docs.length === 0 && deletes.length === 0) return
  const operations: Array<estypes.BulkOperationContainer | CatalogDocument> = []
  for (const d of docs) operations.push({ index: { _index: index, _id: d.id } }, d)
  for (const id of deletes) operations.push({ delete: { _index: index, _id: id } })
  // Writes may wait for a refresh (wait_for); only queries keep the short 3 s client timeout.
  const res = await getSearchClient().bulk({ operations, refresh }, { requestTimeout: 30_000 })
  if (res.errors) {
    const failed = res.items.filter((i) => {
      const op = i.index ?? i.delete
      return op?.error && !(i.delete && op.status === 404)
    })
    if (failed.length)
      throw new Error(
        `bulk indexing failed for ${failed.length} item(s): ${JSON.stringify(failed[0])}`,
      )
  }
}

export interface RebuildResult {
  index: string
  count: number
  caughtUp: number
  removed: string[]
}

/** Index administration (create, settings, refresh, alias swap) can take seconds on a busy node. */
const ADMIN = { requestTimeout: 30_000 }

/**
 * Nightly rebuild (CATALOG §8.4): new index → bulk load → verify count → atomic alias swap →
 * re-apply products changed while building → drop old indices (the previous one is kept for rollback).
 */
export async function rebuildSearchIndex(): Promise<RebuildResult> {
  const es = getSearchClient()
  const alias = aliasName()
  const index = `${alias}-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .toLowerCase()}`
  const started = new Date(Date.now() - 1_000)
  await es.indices.create(
    {
      index,
      settings: { ...INDEX_SETTINGS, refresh_interval: '-1' },
      mappings: INDEX_MAPPINGS,
    },
    ADMIN,
  )
  let count = 0
  try {
    for await (const batch of allCatalogDocuments()) {
      await bulkWrite(index, batch)
      count += batch.length
    }
    await es.indices.putSettings({ index, settings: { refresh_interval: '1s' } }, ADMIN)
    await es.indices.refresh({ index }, ADMIN)
    const indexed = (await es.count({ index })).count
    if (indexed !== count)
      throw new Error(`index verification failed: ${indexed} of ${count} documents`)
  } catch (err) {
    await es.indices.delete({ index }, { ...ADMIN, ignore: [404] })
    throw err
  }

  // A concrete index can't share the alias's name (only possible with hand-made indices).
  if (
    (await es.indices.exists({ index: alias })) &&
    !(await es.indices.existsAlias({ name: alias }))
  )
    throw new Error(`a concrete index named "${alias}" blocks the alias; delete it first`)
  const previous = await aliasTargets()
  await es.indices.updateAliases(
    {
      actions: [
        ...previous.map((i) => ({ remove: { index: i, alias } })),
        { add: { index, alias, is_write_index: true } },
      ],
    },
    ADMIN,
  )

  const changed = await changedProductIdsSince(started)
  await upsertSearchDocuments(changed)

  const all = Object.keys(await es.indices.get({ index: `${alias}-*` })).sort()
  const removed = all.filter((i) => i !== index && !previous.includes(i))
  // Keep the newest previous index for a quick rollback; drop the rest.
  removed.push(
    ...previous
      .filter((i) => i !== index)
      .sort()
      .slice(0, -1),
  )
  for (const i of removed) await es.indices.delete({ index: i }, { ...ADMIN, ignore: [404] })
  return { index, count, caughtUp: changed.length, removed }
}

/**
 * Near-real-time sync for `product.changed` (JOB-search.upsertProduct): index the current
 * documents, delete the ones that no longer exist. Builds the index first if there is none.
 */
export async function upsertSearchDocuments(
  ids: string[],
): Promise<{ indexed: number; deleted: number }> {
  if (ids.length === 0) return { indexed: 0, deleted: 0 }
  if ((await aliasTargets()).length === 0) {
    const { count } = await rebuildSearchIndex()
    return { indexed: count, deleted: 0 }
  }
  const docs = await getCatalogDocuments(ids)
  const found = new Set(docs.map((d) => d.id))
  const deletes = ids.filter((id) => !found.has(id))
  // wait_for: the change is searchable when the job completes (≤ 1 s refresh interval)
  await bulkWrite(aliasName(), docs, deletes, 'wait_for')
  return { indexed: docs.length, deleted: deletes.length }
}

// ---------------------------------------------------------------------------------- querying

type Query = estypes.QueryDslQueryContainer

function filters(query: CatalogQuery) {
  const base: Query[] = [
    { term: { listed: true } },
    {
      bool: {
        should: [
          { bool: { must_not: { exists: { field: 'hiddenUntil' } } } },
          { range: { hiddenUntil: { lte: 'now' } } },
        ],
        minimum_should_match: 1,
      },
    },
  ]
  if (query.merchant) base.push({ term: { merchantSlug: query.merchant } })
  if (query.organic) base.push({ term: { organic: true } })
  if (query.onSale) base.push({ term: { onSale: true } })
  if (query.inStock) base.push({ term: { inStock: true } })
  for (const claim of query.dietary ?? []) base.push({ term: { dietaryClaims: claim } })
  if (query.minPriceCents !== undefined || query.maxPriceCents !== undefined)
    base.push({
      range: { effectivePriceCents: { gte: query.minPriceCents, lte: query.maxPriceCents } },
    })
  const category: Query[] = query.category ? [{ term: { categorySlug: query.category } }] : []
  const subcategory: Query[] = query.subcategory
    ? [{ term: { subcategorySlug: query.subcategory } }]
    : []
  return { base, category, subcategory }
}

/**
 * Relevance (CATALOG §8.3): name^4, brand^2, subcategory^2, category; typo tolerance (fuzziness
 * AUTO, analysed without synonyms: Lucene can't fuzz a synonym graph), synonyms (exact-term match
 * through the synonym analyzer), prefixes (edge n-grams), exact name ×3, on sale ×1.2,
 * popularity (log), in stock ×1.1.
 */
export function textQuery(q: string): Query {
  const fields = ['name^4', 'brand^2', 'subcategory^2', 'category', 'description^0.3']
  return {
    bool: {
      should: [
        {
          multi_match: {
            query: q,
            fields,
            type: 'most_fields',
            operator: 'and',
            fuzziness: 'AUTO',
            prefix_length: 1,
            analyzer: 'en_index',
          },
        },
        { multi_match: { query: q, fields, type: 'most_fields', operator: 'and' } },
        {
          multi_match: {
            query: q,
            type: 'bool_prefix',
            fields: ['name.prefix^3', 'brand.prefix^1.5'],
            operator: 'and',
          },
        },
        { term: { 'name.exact': { value: q.trim().toLowerCase(), boost: 12 } } },
      ],
      minimum_should_match: 1,
    },
  }
}

export function buildSearchRequest(query: CatalogQuery): estypes.SearchRequest {
  const { base, category, subcategory } = filters(query)
  const hasText = !!query.q?.trim()
  const scored: Query = {
    function_score: {
      query: {
        bool: { must: hasText ? [textQuery(query.q!)] : [{ match_all: {} }], filter: base },
      },
      functions: [
        { filter: { term: { onSale: true } }, weight: 1.2 },
        { filter: { term: { inStock: true } }, weight: 1.1 },
        { field_value_factor: { field: 'popularity30d', modifier: 'log2p', missing: 0 } },
      ],
      score_mode: 'multiply',
      boost_mode: 'multiply',
    },
  }
  const sort: estypes.Sort =
    query.sort === 'price_asc'
      ? [{ effectivePriceCents: 'asc' }, { 'name.exact': 'asc' }]
      : query.sort === 'price_desc'
        ? [{ effectivePriceCents: 'desc' }, { 'name.exact': 'asc' }]
        : query.sort === 'name'
          ? [{ 'name.exact': 'asc' }]
          : hasText
            ? ['_score', { 'name.exact': 'asc' }]
            : [{ 'name.exact': 'asc' }]
  return {
    index: aliasName(),
    from: (query.page - 1) * query.limit,
    size: query.limit,
    track_total_hits: true,
    _source: false,
    query: scored,
    // Category/subcategory filters go in post_filter so the category facet ignores them
    post_filter: { bool: { filter: [...category, ...subcategory] } },
    sort,
    aggs: {
      categories: {
        terms: { field: 'categorySlug', size: 100 },
        aggs: { name: { terms: { field: 'category.keyword', size: 1 } } },
      },
      inCategory: {
        filter: { bool: { filter: category } },
        aggs: {
          subcategories: {
            terms: { field: 'subcategorySlug', size: 100 },
            aggs: { name: { terms: { field: 'subcategory.keyword', size: 1 } } },
          },
        },
      },
      selection: {
        filter: { bool: { filter: [...category, ...subcategory] } },
        aggs: {
          organic: { filter: { term: { organic: true } } },
          onSale: { filter: { term: { onSale: true } } },
          dietary: { terms: { field: 'dietaryClaims', size: 50 } },
          minPrice: { min: { field: 'effectivePriceCents' } },
          maxPrice: { max: { field: 'effectivePriceCents' } },
        },
      },
    },
  }
}

interface Bucket {
  key: string
  doc_count: number
  name?: { buckets: Array<{ key: string }> }
}

const named = (buckets: Bucket[]) =>
  buckets.map((b) => ({ slug: b.key, name: b.name?.buckets[0]?.key ?? b.key, count: b.doc_count }))

export async function elasticSearch(query: CatalogQuery): Promise<EngineResult> {
  const res = await getSearchClient().search(buildSearchRequest(query), QUERY_TIMEOUT)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- aggregation shapes are defined by the request above
  const aggs = res.aggregations as any
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0)
  const sel = aggs.selection
  return {
    ids: res.hits.hits.map((h) => h._id!),
    total,
    facets: {
      categories: named(aggs.categories.buckets),
      subcategories: query.category ? named(aggs.inCategory.subcategories.buckets) : [],
      organic: sel.organic.doc_count,
      onSale: sel.onSale.doc_count,
      dietary: (sel.dietary.buckets as Bucket[]).map((b) => ({ claim: b.key, count: b.doc_count })),
      price:
        sel.doc_count > 0 ? { minCents: sel.minPrice.value, maxCents: sel.maxPrice.value } : null,
    },
  }
}

export async function pingSearch(): Promise<boolean> {
  try {
    return await getSearchClient().ping({}, { requestTimeout: 1_000 })
  } catch {
    return false
  }
}
