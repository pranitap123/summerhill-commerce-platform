import { getDb } from '@/server/db'

import { expandTerm, queryTerms } from './synonyms'
import type { CatalogQuery, EngineResult, Facets } from './types'

/**
 * Postgres engine (ADR-0007): serves browsing (no text query) and is the fallback when
 * Elasticsearch is unavailable. Typos via pg_trgm word similarity, prefixes via `term:*` full-text
 * queries with English stemming, synonyms by expanding each word. One round trip returns the page
 * of ids, the total and every facet.
 */
const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'for', 'in', 'or'])
// word_similarity threshold: "brocoli"→broccoli 0.7, "salmn"→salmon 0.67 match; "chips"→chicken 0.5 must not
const SIMILARITY = 0.55

class Params {
  values: unknown[] = []
  add(v: unknown): string {
    this.values.push(v)
    return `$${this.values.length}`
  }
}

/** Text match and score expressions for the query's words. */
function textClauses(q: string | undefined, p: Params): { where: string[]; score: string } {
  const terms = q ? queryTerms(q).filter((t) => !STOPWORDS.has(t)) : []
  if (terms.length === 0) return { where: [], score: '0' }
  const where: string[] = []
  const scores: string[] = []
  for (const term of terms) {
    const alts = expandTerm(term)
    const tsq = p.add(alts.map((a) => `${a}:*`).join(' | '))
    const sims = alts.filter((a) => a.length >= 3).map((a) => `word_similarity(${p.add(a)}, b.doc)`)
    const sim = sims.length ? `GREATEST(${sims.join(', ')})` : '0'
    where.push(`(b.tsv @@ to_tsquery('english', ${tsq}) OR ${sim} >= ${SIMILARITY})`)
    scores.push(`ts_rank(b.tsv, to_tsquery('english', ${tsq})) + ${sim}`)
  }
  const exact = `(CASE WHEN lower(b.name) = ${p.add(q!.trim().toLowerCase())} THEN 3 ELSE 0 END)`
  return { where, score: `(${scores.join(' + ')}) + ${exact}` }
}

function orderBy(sort: CatalogQuery['sort'], hasText: boolean): string {
  switch (sort) {
    case 'price_asc':
      return 'price ASC, name ASC, id'
    case 'price_desc':
      return 'price DESC, name ASC, id'
    case 'name':
      return 'name ASC, id'
    default:
      return hasText
        ? 'score DESC, (price < regular) DESC, in_stock DESC, name ASC, id'
        : 'category_order ASC, name ASC, id'
  }
}

export async function postgresSearch(query: CatalogQuery): Promise<EngineResult> {
  const p = new Params()
  const text = textClauses(query.q, p)
  const base: string[] = [...text.where]
  if (query.merchant) base.push(`b.merchant_slug = ${p.add(query.merchant)}`)
  if (query.organic) base.push('b.organic')
  if (query.onSale) base.push('b.price < b.regular')
  if (query.inStock) base.push('b.in_stock')
  if (query.dietary?.length) base.push(`b.dietary_claims @> ${p.add(query.dietary)}::text[]`)
  if (query.minPriceCents !== undefined) base.push(`b.price >= ${p.add(query.minPriceCents)}`)
  if (query.maxPriceCents !== undefined) base.push(`b.price <= ${p.add(query.maxPriceCents)}`)
  const cat = query.category ? `category_slug = ${p.add(query.category)}` : 'true'
  const sub = query.subcategory ? `subcategory_slug = ${p.add(query.subcategory)}` : 'true'
  const limit = p.add(query.limit)
  const offset = p.add((query.page - 1) * query.limit)

  const sql = `
    WITH b AS (
      SELECT v.id, v.name, v.category, v.category_slug, v.subcategory, v.subcategory_slug,
        v.merchant_slug, v.organic, v.dietary_claims, v.availability = 'in_stock' AS in_stock,
        c.sort_order AS category_order, s.sort_order AS subcategory_order,
        v.unit_price_cents AS regular,
        LEAST(v.unit_price_cents, COALESCE((SELECT min(pr.sale_price_cents) FROM catalog.promotions pr
          WHERE pr.product_id = v.id AND (pr.starts_at IS NULL OR pr.starts_at <= now())
            AND (pr.ends_at IS NULL OR pr.ends_at > now())), v.unit_price_cents)) AS price,
        lower(v.name || ' ' || coalesce(v.brand, '') || ' ' || v.subcategory || ' ' || v.category) AS doc,
        to_tsvector('english', v.name || ' ' || coalesce(v.brand, '') || ' ' || v.subcategory || ' ' || v.category) AS tsv
      FROM catalog.product_view v
      JOIN catalog.subcategories s ON s.id = v.subcategory_id
      JOIN catalog.categories c ON c.id = s.category_id
      WHERE v.is_visible
    ),
    m AS (
      SELECT b.id, b.name, b.category, b.category_slug, b.subcategory, b.subcategory_slug, b.organic,
        b.dietary_claims, b.in_stock, b.category_order, b.subcategory_order, b.regular, b.price,
        ${text.score} AS score
      FROM b ${base.length ? `WHERE ${base.join(' AND ')}` : ''}
    ),
    sel AS (SELECT * FROM m WHERE ${cat} AND ${sub})
    SELECT
      (SELECT count(*) FROM sel)::int AS total,
      (SELECT COALESCE(json_agg(x ORDER BY x.o, x.name), '[]') FROM (
         SELECT category_slug AS slug, category AS name, count(*)::int AS count, min(category_order) AS o
         FROM m WHERE category_slug IS NOT NULL GROUP BY category_slug, category) x) AS categories,
      (SELECT COALESCE(json_agg(x ORDER BY x.o, x.name), '[]') FROM (
         SELECT subcategory_slug AS slug, subcategory AS name, count(*)::int AS count, min(subcategory_order) AS o
         FROM m WHERE ${cat} AND subcategory_slug IS NOT NULL GROUP BY subcategory_slug, subcategory) x) AS subcategories,
      (SELECT count(*) FROM sel WHERE organic)::int AS organic,
      (SELECT count(*) FROM sel WHERE price < regular)::int AS on_sale,
      (SELECT COALESCE(json_agg(json_build_object('claim', claim, 'count', n) ORDER BY n DESC, claim), '[]')
         FROM (SELECT claim, count(*)::int AS n FROM sel, unnest(dietary_claims) AS claim GROUP BY claim) d) AS dietary,
      (SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE json_build_object('minCents', min(price), 'maxCents', max(price)) END FROM sel) AS price,
      (SELECT COALESCE(json_agg(id ORDER BY rn), '[]') FROM (
         SELECT id, row_number() OVER (ORDER BY ${orderBy(query.sort, !!text.where.length)}) AS rn
         FROM sel ORDER BY rn LIMIT ${limit} OFFSET ${offset}) pg) AS ids`

  const { rows } = await getDb().query<{
    total: number
    categories: Array<{ slug: string; name: string; count: number }>
    subcategories: Array<{ slug: string; name: string; count: number }>
    organic: number
    on_sale: number
    dietary: Facets['dietary']
    price: { minCents: number; maxCents: number } | null
    ids: string[]
  }>(sql, p.values)
  const r = rows[0]
  return {
    ids: r.ids,
    total: r.total,
    facets: {
      categories: r.categories.map(({ slug, name, count }) => ({ slug, name, count })),
      subcategories: (query.category ? r.subcategories : []).map(({ slug, name, count }) => ({
        slug,
        name,
        count,
      })),
      organic: r.organic,
      onSale: r.on_sale,
      dietary: r.dietary,
      price: r.price
        ? { minCents: Number(r.price.minCents), maxCents: Number(r.price.maxCents) }
        : null,
    },
  }
}
