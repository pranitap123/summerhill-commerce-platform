import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDb, sql, type TestDb } from '../setup/testDb'

const ES_URL = process.env.TEST_ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200'
const ALIAS = `it-catalog-${process.pid}-${Date.now()}`

let db: TestDb
let catalog: typeof import('@/modules/catalog')
let search: typeof import('@/modules/search')
let registry: typeof import('@/worker/registry')
let logger: typeof import('@/server/logger')

const ADMIN = { type: 'admin' as const, id: '1' }
const browse = { sort: 'relevance' as const, page: 1, limit: 50 }

async function drainWorker() {
  const log = logger.getLogger()
  for (let i = 0; i < 200; i++) if ((await registry.runOnce('it-worker', log, 50)) === 0) return
  throw new Error('worker did not go idle')
}

async function esIds(q: string) {
  const r = await search.elasticSearch({ ...browse, q })
  return r.ids
}

beforeAll(async () => {
  db = await createTestDb('grocery_catalog_it')
  process.env.CATALOG_DATABASE_URL = db.asRole('app_rw')
  process.env.ELASTICSEARCH_URL = ES_URL
  process.env.SEARCH_INDEX_ALIAS = ALIAS

  process.env.NEXT_PUBLIC_SERVER_URL = 'http://127.0.0.1:9'
  const { resetConfigForTests } = await import('@/server/config')
  resetConfigForTests()
  catalog = await import('@/modules/catalog')
  search = await import('@/modules/search')
  search.resetSearchClientForTests()
  registry = await import('@/worker/registry')
  logger = await import('@/server/logger')
})

afterAll(async () => {
  const es = search?.getSearchClient()
  await es?.indices.delete({ index: `${ALIAS}-*` }, { ignore: [404] }).catch(() => {})
  const { closeDb } = await import('@/server/db')
  await closeDb()
  await db?.drop()
})

describe('catalogue read path (G3-09, G3-10)', () => {
  it('resolves a product by slug, legacy id and old slug', async () => {
    const byId = await catalog.resolveProduct('DEMO-0001')
    expect(byId?.redirect).toBe(true)
    const slug = byId!.product.slug
    expect(slug).toMatch(/^lakeside-farms-honeycrisp-apples-[0-9a-f]{6}$/)
    expect(await catalog.resolveProduct(slug)).toMatchObject({ redirect: false })
    await sql(
      db.adminUrl,
      `INSERT INTO catalog.product_slug_history (slug, product_id) VALUES ('old-apples-000000', 'DEMO-0001')`,
    )
    expect(await catalog.resolveProduct('old-apples-000000')).toMatchObject({
      redirect: true,
      product: { id: 'DEMO-0001' },
    })
    expect(await catalog.resolveProduct('nope')).toBeNull()
  })

  it('exposes the canonical model: brand, claims, unit prices, availability days', async () => {
    const all = await search.findProducts({ ...browse, limit: 50, page: 1 })
    expect(all.total).toBeGreaterThan(200)
    const products = await catalog.getProductsByIds(
      (await sql(db.adminUrl, 'SELECT id FROM catalog.products')).rows.map((r) => r.id),
    )
    expect(products.every((p) => p.merchantSlug === 'demo-market' && p.slug)).toBe(true)
    expect(products.some((p) => p.categorySlug === 'dairy-eggs' && p.brand)).toBe(true)
    expect(products.some((p) => p.comparisonPrice?.per === '100 g')).toBe(true)
    expect(products.some((p) => p.comparisonPrice?.per === '100 ml')).toBe(true)
    expect(products.some((p) => p.availableDays.length === 6)).toBe(true)
    expect(products.some((p) => p.dietaryClaims.length > 0)).toBe(true)
    expect(
      products.filter((p) => p.pricingModel === 'per_weight').every((p) => !p.comparisonPrice),
    ).toBe(true)
  })

  it('returns the category tree with counts that add up', async () => {
    const tree = await catalog.listCategories()
    expect(tree).toHaveLength(8)
    const visible = Number(
      (await sql(db.adminUrl, 'SELECT count(*) FROM catalog.product_view WHERE is_visible')).rows[0]
        .count,
    )
    expect(tree.reduce((n, c) => n + c.productCount, 0)).toBe(visible)
    for (const c of tree)
      expect(c.subcategories.reduce((n, s) => n + s.productCount, 0)).toBe(c.productCount)
  })

  it('lists storefront merchants with locations', async () => {
    const [m] = await catalog.listMerchants()
    expect(m).toMatchObject({ slug: 'demo-market', minOrderCents: 1500 })
    expect(m.locations[0]).toMatchObject({ slug: 'downtown', city: 'Toronto' })
    expect(m.productCount).toBeGreaterThan(200)
  })
})

describe('facets are consistent with filters (G3-09)', () => {
  it('each facet count equals the total after applying that facet', async () => {
    const base = await search.findProducts(browse)
    for (const c of base.facets.categories) {
      const r = await search.findProducts({ ...browse, category: c.slug })
      expect(r.total, c.slug).toBe(c.count)
      for (const s of r.facets.subcategories) {
        const rs = await search.findProducts({ ...browse, category: c.slug, subcategory: s.slug })
        expect(rs.total, s.slug).toBe(s.count)
      }
    }
    expect((await search.findProducts({ ...browse, organic: true })).total).toBe(
      base.facets.organic,
    )
    expect((await search.findProducts({ ...browse, onSale: true })).total).toBe(base.facets.onSale)
    for (const d of base.facets.dietary)
      expect((await search.findProducts({ ...browse, dietary: [d.claim] })).total).toBe(d.count)
    expect(base.facets.onSale).toBeGreaterThan(0)
    const sale = await search.findProducts({ ...browse, onSale: true })
    expect(sale.items.every((p) => p.onSale && p.effectivePriceCents < p.unitPriceCents)).toBe(true)
  })

  it('filters by price range on the effective price', async () => {
    const r = await search.findProducts({ ...browse, minPriceCents: 500, maxPriceCents: 1000 })
    expect(r.items.length).toBeGreaterThan(0)
    expect(
      r.items.every((p) => p.effectivePriceCents >= 500 && p.effectivePriceCents <= 1000),
    ).toBe(true)
  })
})

describe('Elasticsearch index (G3-08)', () => {
  it('rebuilds into a new index, verifies the count and swaps the alias', async () => {
    const first = await search.rebuildSearchIndex()
    const expected = Number(
      (await sql(db.adminUrl, 'SELECT count(*) FROM catalog.products WHERE deleted_at IS NULL'))
        .rows[0].count,
    )
    expect(first.count).toBe(expected)
    const second = await search.rebuildSearchIndex()
    const es = search.getSearchClient()
    const targets = Object.keys(await es.indices.getAlias({ name: ALIAS }))
    expect(targets).toEqual([second.index])

    expect(await es.indices.exists({ index: first.index })).toBe(true)
    await search.rebuildSearchIndex()
    expect(await es.indices.exists({ index: first.index })).toBe(false)
  })

  it.each([
    ['typo', 'brocoli', /Broccoli/],
    ['typo', 'sourdogh', /Sourdough/],
    ['prefix', 'sourd', /Sourdough/],
    ['prefix', 'croiss', /Croissant/],
    ['synonym', 'courgette', /Zucchini/],
    ['synonym', 'crisps', /Chips/],
    ['synonym', 'pop', /Soda/],
    ['stemming', 'cookie', /Cookies/],
  ])('%s: "%s"', async (_kind, q, expected) => {
    const ids = await esIds(q)
    expect(ids.length).toBeGreaterThan(0)
    const [top] = await catalog.getProductsByIds(ids.slice(0, 1))
    expect(top.name).toMatch(expected)
  })

  it('ranks an exact name match first', async () => {
    const [p] = await catalog.getProductsByIds(['DEMO-0010'])
    const ids = await esIds(p.name)
    expect(ids[0]).toBe('DEMO-0010')
  })

  it('facets match the Postgres engine', async () => {
    const [es, pg] = await Promise.all([
      search.elasticSearch({ ...browse, q: 'chips' }),
      search.postgresSearch({ ...browse, q: 'chips' }),
    ])
    expect(es.total).toBeGreaterThan(0)
    expect(es.facets.categories.map((c) => c.slug)).toEqual(
      expect.arrayContaining(pg.facets.categories.map((c) => c.slug)),
    )
    const browseEs = await search.elasticSearch({ ...browse, sort: 'name' })
    const browsePg = await search.postgresSearch({ ...browse, sort: 'name' })
    expect(browseEs.total).toBe(browsePg.total)
    expect(browseEs.facets.organic).toBe(browsePg.facets.organic)
    expect(browseEs.facets.onSale).toBe(browsePg.facets.onSale)
    expect(new Map(browseEs.facets.dietary.map((d) => [d.claim, d.count]))).toEqual(
      new Map(browsePg.facets.dietary.map((d) => [d.claim, d.count])),
    )
  })

  it('meets p95 < 300 ms locally (search and browse)', async () => {
    const queries = [
      'apple',
      'brocoli',
      'sourd',
      'crisps',
      'organic milk',
      'salmon',
      'cake',
      'rice',
    ]
    const timings: number[] = []
    for (let i = 0; i < 5; i++)
      for (const q of queries) {
        const t = performance.now()
        await search.findProducts({ ...browse, q, limit: 24 }, { log: false })
        timings.push(performance.now() - t)
        const b = performance.now()
        await search.findProducts({ ...browse, limit: 24, category: 'produce' })
        timings.push(performance.now() - b)
      }
    timings.sort((a, b) => a - b)
    const p95 = timings[Math.floor(timings.length * 0.95)]
    expect(p95).toBeLessThan(300)
  })
})

describe('overrides + outbox sync (G3-11, G3-08, X2)', () => {
  it('a hide override removes the product everywhere, and clearing it brings it back', async () => {
    const id = 'DEMO-0020'
    const [p] = await catalog.getProductsByIds([id])
    await catalog.setProductOverride(id, { hidden: true }, ADMIN, 'req-it')
    expect(await catalog.resolveProduct(p.slug)).toBeNull()
    expect((await catalog.getPricingProducts([id]))[0].available).toBe(false)
    const outbox = await sql(
      db.adminUrl,
      `SELECT count(*)::int AS n FROM ops.outbox WHERE topic = 'product.changed' AND key = $1 AND published_at IS NULL`,
      [id],
    )
    expect(outbox.rows[0].n).toBe(1)
    const audits = await sql(
      db.adminUrl,
      `SELECT action FROM ops.audit_log WHERE target_id = $1 ORDER BY id`,
      [id],
    )
    expect(audits.rows.map((r) => r.action)).toEqual(['catalog.override.set'])

    await drainWorker()
    expect(await esIds(p.name)).not.toContain(id)

    expect(await catalog.clearProductOverride(id, ADMIN)).toBe(true)
    await drainWorker()
    expect((await esIds(p.name))[0]).toBe(id)
  })

  it('a rename override is searchable and survives on the product page', async () => {
    const id = 'DEMO-0030'
    await catalog.setProductOverride(id, { name: 'Staff Favourite Wonderloaf' }, ADMIN)
    await drainWorker()
    const [p] = await catalog.getProductsByIds([id])
    expect(p.name).toBe('Staff Favourite Wonderloaf')
    expect((await esIds('wonderloaf'))[0]).toBe(id)
  })

  it('a deleted product is removed from the index', async () => {
    const id = 'DEMO-0040'
    await sql(db.adminUrl, 'UPDATE catalog.products SET deleted_at = now() WHERE id = $1', [id])
    await sql(
      db.adminUrl,
      `INSERT INTO ops.outbox (topic, key, payload) VALUES ('product.changed', $1, '{}')`,
      [id],
    )
    await drainWorker()
    const doc = await search.getSearchClient().exists({ index: ALIAS, id })
    expect(doc).toBe(false)
  })

  it('app_rw can write overrides but not products', async () => {
    await expect(
      sql(db.asRole('app_rw'), `UPDATE catalog.products SET name = 'x' WHERE id = 'DEMO-0001'`),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('fallback and analytics (G3-08, G3-15)', () => {
  it('falls back to Postgres when Elasticsearch is down', async () => {
    process.env.ELASTICSEARCH_URL = 'http://127.0.0.1:1'
    const { resetConfigForTests } = await import('@/server/config')
    resetConfigForTests()
    search.resetSearchClientForTests()
    try {
      const r = await search.findProducts({ ...browse, q: 'brocoli' })
      expect(r.engine).toBe('postgres')
      expect(r.items[0].name).toMatch(/Broccoli/)
      const syn = await search.findProducts({ ...browse, q: 'courgette' })
      expect(syn.items[0].name).toMatch(/Zucchini/)
      const prefix = await search.findProducts({ ...browse, q: 'sourd' })
      expect(prefix.items[0].name).toMatch(/Sourdough/)
    } finally {
      process.env.ELASTICSEARCH_URL = ES_URL
      resetConfigForTests()
      search.resetSearchClientForTests()
    }
  })

  it('opens the circuit when Elasticsearch hangs, then answers from Postgres at once (G6-05)', async () => {
    const hung = http.createServer(() => {})
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r))
    process.env.ELASTICSEARCH_URL = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`
    const { resetConfigForTests } = await import('@/server/config')
    const { circuitStates } = await import('@/server/outbound')
    resetConfigForTests()
    search.resetSearchClientForTests()
    try {
      for (let i = 0; i < 2 && circuitStates().elasticsearch !== 'open'; i++)
        expect((await search.findProducts({ ...browse, q: 'apples' })).engine).toBe('postgres')
      expect(circuitStates().elasticsearch).toBe('open')
      const started = performance.now()
      const r = await search.findProducts({ ...browse, q: 'brocoli' })
      expect(r.engine).toBe('postgres')
      expect(r.items[0].name).toMatch(/Broccoli/)
      expect(performance.now() - started).toBeLessThan(1_000)
    } finally {
      hung.closeAllConnections()
      await new Promise<void>((r) => hung.close(() => r()))
      process.env.ELASTICSEARCH_URL = ES_URL
      resetConfigForTests()
      search.resetSearchClientForTests()
    }
  })

  it('logs searches and clicks without personal data and reports on them', async () => {
    const hit = await search.findProducts({ ...browse, q: 'apples' })
    expect(hit.searchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await search.recordSearchClick(hit.searchId!, hit.items[1].id, 2)).toBe(true)
    expect(await search.recordSearchClick(hit.searchId!, hit.items[1].id, 2)).toBe(false)
    expect(
      await search.recordSearchClick('00000000-0000-4000-8000-000000000000', 'DEMO-0001', 1),
    ).toBe(false)
    for (let i = 0; i < 3; i++) await search.findProducts({ ...browse, q: 'unicornfruit' })
    await search.findProducts({ ...browse, q: 'jane.doe@example.com' })

    const report = await search.searchReport(7)
    expect(report.zeroResultQueries[0]).toMatchObject({ query: 'unicornfruit', searches: 3 })
    expect(report.topQueries.map((q) => q.query)).toContain('apples')
    expect(report.clickPositions).toEqual(expect.arrayContaining([{ position: 2, clicks: 1 }]))
    expect(report.meanClickPosition).not.toBeNull()
    expect(report.clickThroughRate).toBeGreaterThan(0)
    const stored = await sql(db.adminUrl, 'SELECT query FROM ops.search_queries')
    expect(stored.rows.map((r) => r.query)).toContain('[redacted]')
    expect(stored.rows.map((r) => r.query).join(' ')).not.toMatch(/@/)
  })
})
