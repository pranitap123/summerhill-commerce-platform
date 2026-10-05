import { describe, expect, it } from 'vitest'

import { comparisonPrice, parsePackSize } from '@/modules/catalog'
import {
  buildSearchRequest,
  expandTerm,
  INDEX_MAPPINGS,
  INDEX_SETTINGS,
  normaliseQuery,
  queryTerms,
  SYNONYMS,
  type CatalogQuery,
} from '@/modules/search'
import { resetConfigForTests } from '@/server/config'
import { signRevalidation, verifyRevalidation } from '@/server/revalidate'
import { resetSigningKeysForTests } from '@/server/signing'

describe('comparison unit price (G3-10)', () => {
  it.each([
    ['Spaghetti 500 g', { amount: 500, kind: 'g' }],
    ['Basmati Rice 2 kg', { amount: 2000, kind: 'g' }],
    ['Cola 2 L', { amount: 2000, kind: 'ml' }],
    ['Table Cream 473 ml', { amount: 473, kind: 'ml' }],
    ['Free Run Eggs 12 ea', { amount: 12, kind: 'count' }],
    ['California Roll 8 pc', { amount: 8, kind: 'count' }],
    ['Sourdough Loaf', null],
    ['Single Muffin 1 ea', null],
  ])('%s', (name, size) => {
    expect(parsePackSize(name)).toEqual(size)
  })

  it('computes per 100 g / 100 ml / item, rounded to the cent', () => {
    expect(comparisonPrice('Spaghetti 500 g', 399, 'each')).toEqual({ cents: 80, per: '100 g' })
    expect(comparisonPrice('Cola 2 L', 299, 'each')).toEqual({ cents: 15, per: '100 ml' })
    expect(comparisonPrice('Eggs 12 ea', 699, 'each')).toEqual({ cents: 58, per: 'item' })
    expect(comparisonPrice('Bananas', 69, 'per_weight')).toBeNull()
    expect(comparisonPrice('Spaghetti 500 g', 399, 'per_weight')).toBeNull()
  })
})

describe('query parsing and synonyms (G3-08)', () => {
  it('reduces queries to safe lowercase words', () => {
    expect(queryTerms("Crème  brûlée's & (chips)!")).toEqual(['creme', 'brulee', 's', 'chips'])
    expect(queryTerms("x'); DROP TABLE--")).toEqual(['x', 'drop', 'table'])
    expect(queryTerms('a b c d e f g h i j')).toHaveLength(8)
  })

  it('expands single-word synonyms both ways', () => {
    expect(expandTerm('crisps')).toEqual(expect.arrayContaining(['crisps', 'chips']))
    expect(expandTerm('zucchini')).toContain('courgette')
    expect(expandTerm('mince')).toEqual(['mince']) // multi-word partners aren't word-level
    expect(expandTerm('apple')).toEqual(['apple'])
  })

  it('synonym sets are lowercase and every term appears once', () => {
    const all = SYNONYMS.flat()
    expect(all.every((t) => t === t.toLowerCase())).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('the index analyses with synonyms at search time only', () => {
    const analysis = INDEX_SETTINGS.analysis as { analyzer: Record<string, { filter: string[] }> }
    expect(analysis.analyzer.en_search.filter).toContain('en_synonyms')
    expect(analysis.analyzer.en_index.filter).not.toContain('en_synonyms')
    expect(INDEX_MAPPINGS.dynamic).toBe('strict')
  })
})

describe('Elasticsearch request (G3-08, G3-09)', () => {
  const q: CatalogQuery = { sort: 'relevance', page: 2, limit: 24 }

  it('always excludes unlisted and currently hidden products', () => {
    const req = buildSearchRequest(q)
    const json = JSON.stringify(req.query)
    expect(json).toContain('"listed":true')
    expect(json).toContain('"hiddenUntil"')
    expect(req.from).toBe(24)
    expect(req.size).toBe(24)
  })

  it('puts category filters in post_filter so the category facet ignores them', () => {
    const req = buildSearchRequest({
      ...q,
      category: 'bakery',
      subcategory: 'breads',
      organic: true,
    })
    expect(JSON.stringify(req.post_filter)).toContain('bakery')
    expect(JSON.stringify(req.query)).not.toContain('bakery')
    expect(JSON.stringify(req.query)).toContain('"organic":true')
    const aggs = req.aggs as Record<string, { filter?: unknown }>
    expect(JSON.stringify(aggs.inCategory.filter)).toContain('bakery')
    expect(JSON.stringify(aggs.inCategory.filter)).not.toContain('breads')
    expect(JSON.stringify(aggs.selection.filter)).toContain('breads')
  })

  it('combines fuzzy, synonym, prefix and exact-name clauses for text', () => {
    const json = JSON.stringify(buildSearchRequest({ ...q, q: 'Sourd' }).query)
    expect(json).toContain('"fuzziness":"AUTO"')
    expect(json).toContain('bool_prefix')
    expect(json).toContain('name.exact')
    expect(json).toContain('"weight":1.2') // on-sale boost
  })

  it('sorts by price on request', () => {
    expect(buildSearchRequest({ ...q, sort: 'price_asc' }).sort).toEqual([
      { effectivePriceCents: 'asc' },
      { 'name.exact': 'asc' },
    ])
  })
})

describe('search analytics privacy (G3-15)', () => {
  it.each([
    ['  Organic   Apples ', 'organic apples'],
    ['jane.doe@example.com', '[redacted]'],
    ['call 416-555-0199', '[redacted]'],
    ['(416) 555 0199', '[redacted]'],
    ['2 L milk', '2 l milk'],
  ])('%s → %s', (input, stored) => {
    expect(normaliseQuery(input)).toBe(stored)
  })
})

describe('storefront revalidation signing (G3-13)', () => {
  it('accepts fresh signed tags and rejects tampering, age and bad tags', () => {
    resetConfigForTests()
    resetSigningKeysForTests()
    const now = Date.now()
    const signed = signRevalidation(['catalog', 'product:DEMO-0001'], now)
    expect(verifyRevalidation(signed, now)).toEqual(['catalog', 'product:DEMO-0001'])
    expect(verifyRevalidation(signed, now + 6 * 60_000)).toBeNull()
    expect(verifyRevalidation(`${signed.slice(0, -2)}xx`, now)).toBeNull()
    expect(verifyRevalidation(signRevalidation(['../etc'], now), now)).toBeNull()
    expect(verifyRevalidation(signRevalidation([], now), now)).toBeNull()
    expect(verifyRevalidation(undefined, now)).toBeNull()
  })
})
