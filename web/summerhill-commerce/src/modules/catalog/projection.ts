import { effectivePrice } from '@/modules/pricing'
import { getDb } from '@/server/db'

/**
 * The search projection (CATALOG §8.2): one flat document per non-deleted product. Visibility parts
 * are indexed separately (not a stored flag) because `hidden_until` expires on its own.
 */
export interface CatalogDocument {
  id: string
  slug: string
  merchantId: number
  merchantSlug: string
  name: string
  brand: string | null
  description: string
  category: string
  categorySlug: string | null
  subcategory: string
  subcategorySlug: string | null
  organic: boolean
  dietaryClaims: string[]
  pricingModel: 'each' | 'per_weight'
  unit: 'ea' | 'lb'
  effectivePriceCents: number
  onSale: boolean
  taxCode: string
  inStock: boolean
  /** Listed, not blocked, not hidden (ignoring hidden_until), merchant on the storefront. */
  listed: boolean
  hiddenUntil: string | null
  popularity30d: number
  image: string | null
  updatedAt: string
}

interface Row {
  id: string
  slug: string | null
  merchant_id: string
  merchant_slug: string
  name: string
  brand: string | null
  description: string
  category: string
  category_slug: string | null
  subcategory: string
  subcategory_slug: string | null
  organic: boolean
  dietary_claims: string[]
  pricing_model: 'each' | 'per_weight'
  unit: 'ea' | 'lb'
  unit_price_cents: string
  tax_code: string
  availability: string
  listed: boolean
  hidden_until: Date | null
  popularity: string
  images: string[]
  updated_at: Date
  promotions: Array<{
    sale_price_cents: number
    label: string
    starts_at: string | null
    ends_at: string | null
  }>
}

const SELECT = `SELECT v.id, v.slug, v.merchant_id, v.merchant_slug, v.name, v.brand, v.description,
    v.category, v.category_slug, v.subcategory, v.subcategory_slug, v.organic, v.dietary_claims,
    v.pricing_model, v.unit, v.unit_price_cents, v.tax_code, v.availability, v.images, v.updated_at,
    v.hidden_until,
    (v.source_status = 'listed' AND v.blocked_reason IS NULL AND NOT v.hidden
      AND (SELECT storefront_visible FROM merchant.merchants m WHERE m.id = v.merchant_id)) AS listed,
    (SELECT count(*) FROM commerce.order_lines ol JOIN commerce.orders o ON o.id = ol.order_id
      WHERE ol.product_id = v.id AND o.placed_at > now() - interval '30 days') AS popularity,
    COALESCE((SELECT json_agg(json_build_object('sale_price_cents', pr.sale_price_cents, 'label', pr.label,
                'starts_at', pr.starts_at, 'ends_at', pr.ends_at))
              FROM catalog.promotions pr WHERE pr.product_id = v.id), '[]'::json) AS promotions
  FROM catalog.product_view v
  WHERE v.deleted_at IS NULL`

function toDocument(r: Row, now: Date): CatalogDocument {
  const unitPriceCents = Number(r.unit_price_cents)
  const best = effectivePrice(
    {
      unitPriceCents,
      promotions: r.promotions.map((p) => ({
        salePriceCents: Number(p.sale_price_cents),
        label: p.label,
        startsAt: p.starts_at ? new Date(p.starts_at) : null,
        endsAt: p.ends_at ? new Date(p.ends_at) : null,
      })),
    },
    now,
  )
  return {
    id: r.id,
    slug: r.slug ?? r.id,
    merchantId: Number(r.merchant_id),
    merchantSlug: r.merchant_slug,
    name: r.name,
    brand: r.brand,
    description: r.description,
    category: r.category,
    categorySlug: r.category_slug,
    subcategory: r.subcategory,
    subcategorySlug: r.subcategory_slug,
    organic: r.organic,
    dietaryClaims: r.dietary_claims,
    pricingModel: r.pricing_model,
    unit: r.unit,
    effectivePriceCents: best.unitPriceCents,
    onSale: best.unitPriceCents < unitPriceCents,
    taxCode: r.tax_code,
    inStock: r.availability === 'in_stock',
    listed: r.listed,
    hiddenUntil: r.hidden_until ? new Date(r.hidden_until).toISOString() : null,
    popularity30d: Number(r.popularity),
    image: r.images[0] ?? null,
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

/** Documents for the given products (missing ids = deleted: remove them from the index). */
export async function getCatalogDocuments(ids: string[]): Promise<CatalogDocument[]> {
  if (ids.length === 0) return []
  const { rows } = await getDb().query<Row>(`${SELECT} AND v.id = ANY($1::text[])`, [ids])
  const now = new Date()
  return rows.map((r) => toDocument(r, now))
}

/** Every document, in pages of `batch`, for the nightly rebuild. */
export async function* allCatalogDocuments(batch = 500): AsyncGenerator<CatalogDocument[]> {
  let after = ''
  const now = new Date()
  for (;;) {
    const { rows } = await getDb().query<Row>(`${SELECT} AND v.id > $1 ORDER BY v.id LIMIT $2`, [
      after,
      batch,
    ])
    if (rows.length === 0) return
    yield rows.map((r) => toDocument(r, now))
    after = rows[rows.length - 1].id
  }
}

/** Ids of products changed since `since` (catches up writes made during a rebuild). */
export async function changedProductIdsSince(since: Date): Promise<string[]> {
  const { rows } = await getDb().query<{ id: string }>(
    `SELECT id FROM catalog.product_view WHERE updated_at >= $1
     UNION SELECT product_id FROM catalog.promotions WHERE updated_at >= $1`,
    [since],
  )
  return rows.map((r) => r.id)
}

export async function countCatalogDocuments(): Promise<number> {
  const { rows } = await getDb().query<{ n: string }>(
    'SELECT count(*) AS n FROM catalog.products WHERE deleted_at IS NULL',
  )
  return Number(rows[0].n)
}
