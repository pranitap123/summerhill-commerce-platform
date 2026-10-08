import { execFileSync } from 'node:child_process'
import path from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://grocery_admin:local_dev_only@127.0.0.1:5433/grocery'
const ROLE_PASSWORD = process.env.TEST_ROLE_PASSWORD ?? 'local_dev_only'
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const dbName = `grocery_it_${process.pid}_${Date.now()}`

const withDb = (url: string, db: string, user?: string) => {
  const u = new URL(url)
  u.pathname = `/${db}`
  if (user) {
    u.username = user
    u.password = ROLE_PASSWORD
  }
  return u.toString()
}
const testUrl = withDb(ADMIN_URL, dbName)
const asRole = (role: string) => withDb(ADMIN_URL, dbName, role)

async function sql(url: string, text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}
const runScript = (script: string, env: Record<string, string>, arg?: string) =>
  execFileSync(process.execPath, [path.join(REPO_ROOT, script), ...(arg ? [arg] : [])], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

type Catalog = typeof import('@/modules/catalog')
type Merchant = typeof import('@/modules/merchant')
type Search = typeof import('@/modules/search')
let catalog: Catalog
let merchant: Merchant
let search: Search

beforeAll(async () => {
  await sql(ADMIN_URL, `CREATE DATABASE ${dbName}`)
  await sql(ADMIN_URL, `GRANT CONNECT ON DATABASE ${dbName} TO app_rw, ingest_rw, readonly`)
  runScript('db/migrate.mjs', { MIGRATION_DATABASE_URL: testUrl })
  runScript('db/seed/seed.mjs', {
    SEED_DATABASE_URL: testUrl,
    INGEST_DATABASE_URL: asRole('ingest_rw'),
  })

  process.env.CATALOG_DATABASE_URL = asRole('app_rw')
  const { resetConfigForTests } = await import('@/server/config')
  resetConfigForTests()
  catalog = await import('@/modules/catalog')
  merchant = await import('@/modules/merchant')
  search = await import('@/modules/search')
})

afterAll(async () => {
  const { closeDb } = await import('@/server/db')
  await closeDb()
  await sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
})

describe('migrations', () => {
  it('are all applied and a second run is a no-op', () => {
    const status = runScript('db/migrate.mjs', { MIGRATION_DATABASE_URL: testUrl }, 'status')
    expect(status).not.toMatch(/PENDING/)
    expect(runScript('db/migrate.mjs', { MIGRATION_DATABASE_URL: testUrl })).toMatch(/up to date/)
  })

  it('seed is idempotent', () => {
    const out = runScript('db/seed/seed.mjs', { SEED_DATABASE_URL: testUrl })
    expect(out).toMatch(/products: '219'/)
  })
})

describe('catalog module (as app_rw)', () => {
  it('browses products sorted by effective price with pagination', async () => {
    const q = { sort: 'price_asc' as const, page: 1, limit: 20 }
    const page1 = await search.findProducts(q)
    const page2 = await search.findProducts({ ...q, page: 2 })
    expect(page1.engine).toBe('postgres')
    expect(page1.items).toHaveLength(20)

    const prices = page1.items.map((p) => p.effectivePriceCents)
    expect(prices.every(Number.isInteger)).toBe(true)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
    expect(page2.items[0].effectivePriceCents).toBeGreaterThanOrEqual(prices.at(-1)!)
  })

  it('filters by category slug', async () => {
    const { items } = await search.findProducts({
      category: 'bakery',
      sort: 'price_desc',
      page: 1,
      limit: 50,
    })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((p) => p.category === 'Bakery')).toBe(true)
  })

  it('gets one product, or null', async () => {
    expect(await catalog.getProduct('DEMO-0001')).toMatchObject({
      id: 'DEMO-0001',
      currency: 'CAD',
    })
    expect(await catalog.getProduct('nope')).toBeNull()
  })

  it('returns authoritative pricing data with numeric merchant ids', async () => {
    const rows = await catalog.getPricingProducts(['DEMO-0001', 'DEMO-0002', 'missing'])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.merchantId === 1 && Number.isInteger(r.unitPriceCents))).toBe(true)
    expect(await catalog.getPricingProducts([])).toEqual([])
  })

  it('lists the 8 synthetic categories', async () => {
    expect(await catalog.listCategories()).toHaveLength(8)
  })
})

describe('merchant module (as app_rw)', () => {
  it('reads the seeded merchant', async () => {
    expect(await merchant.getMerchantById(1)).toMatchObject({
      id: 1,
      name: 'Demo Market',
      onboarding_status: 'pending',
    })
    expect(await merchant.listMerchants()).toHaveLength(1)
  })

  it('updates allowed status columns', async () => {
    await merchant.updateMerchantStatus(1, {
      onboarding_status: 'submitted',
      charges_enabled: true,
    })
    expect(await merchant.getMerchantById(1)).toMatchObject({
      onboarding_status: 'submitted',
      charges_enabled: true,
    })
  })

  it('the database rejects values outside the status CHECK constraint', async () => {
    await expect(
      merchant.updateMerchantStatus(1, { onboarding_status: 'hacked' as never }),
    ).rejects.toThrow()
  })
})

describe('least-privilege roles (ADR-0004)', () => {
  it.each([
    ['app_rw', "UPDATE catalog.products SET name = name WHERE id = 'DEMO-0001'", false],
    ['app_rw', 'UPDATE merchant.merchants SET name = name WHERE id = 1', true],
    ['app_rw', 'CREATE TABLE catalog.probe (id int)', false],
    ['ingest_rw', "UPDATE catalog.products SET name = name WHERE id = 'DEMO-0001'", true],
    ['ingest_rw', 'UPDATE merchant.merchants SET name = name WHERE id = 1', false],
    ['readonly', 'SELECT count(*) FROM catalog.products', true],
    ['readonly', "DELETE FROM catalog.products WHERE id = 'x'", false],
  ])('%s: %s → allowed=%s', async (role, statement, allowed) => {
    const attempt = sql(asRole(role), statement)
    if (allowed) await expect(attempt).resolves.toBeDefined()
    else await expect(attempt).rejects.toThrow(/permission denied/)
  })
})
