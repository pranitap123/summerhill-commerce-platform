import { effectivePrice, lbToMlb, type PricingProduct, type TaxCode } from '@/modules/pricing'
import { getDb } from '@/server/db'

import { comparisonPrice, type ComparisonPrice } from './unitPrice'

export interface ProductSummary {
  id: string
  slug: string
  name: string
  brand: string | null

  upc: string | null
  description: string
  currency: string
  sku: string | null
  availability: 'in_stock' | 'out_of_stock'

  isVisible: boolean
  images: string[]
  merchantId: number
  merchantSlug: string
  merchantName: string
  category: string
  categorySlug: string | null
  subcategory: string
  subcategorySlug: string | null
  pricingModel: 'each' | 'per_weight'
  unit: 'ea' | 'lb'
  sellBy: 'quantity' | 'weight'

  unitPriceCents: number

  effectivePriceCents: number
  promoLabel: string | null
  onSale: boolean

  comparisonPrice: ComparisonPrice | null
  estimatedWeightLb: string | null
  weightStepLb: string
  minWeightLb: string
  taxCode: TaxCode
  depositCents: number
  minQty: number
  maxQty: number

  availableDays: number[]
  organic: boolean

  dietaryClaims: string[]
  nutritionLabel: string | null
  disclaimer: string | null
  pickupOnly: boolean
  updatedAt: string
}

interface ProductRow {
  id: string
  slug: string | null
  name: string
  brand: string | null
  upc: string | null
  description: string
  currency: string
  sku: string | null
  availability: 'in_stock' | 'out_of_stock'
  is_visible: boolean
  images: string[]
  merchant_id: string
  merchant_slug: string
  merchant_name: string
  location_id: string
  category: string
  category_slug: string | null
  subcategory: string
  subcategory_slug: string | null
  pricing_model: 'each' | 'per_weight'
  unit: 'ea' | 'lb'
  sell_by: 'quantity' | 'weight'
  unit_price_cents: string
  estimated_weight_lb: string | null
  weight_step_lb: string
  min_weight_lb: string
  tax_code: TaxCode
  deposit_cents: string
  min_qty: number
  max_qty: number
  available_days: number[]
  organic: boolean
  dietary_claims: string[]
  nutrition_label: string | null
  disclaimer: string | null
  pickup_only: boolean
  updated_at: Date
  promotions: Array<{
    sale_price_cents: number
    label: string
    starts_at: string | null
    ends_at: string | null
  }>
}

const PRODUCT_SELECT = `SELECT v.id, v.slug, v.name, v.brand, v.upc, v.description, v.currency, v.sku,
    v.availability, v.is_visible, v.images, v.merchant_id, v.merchant_slug, v.merchant_name,
    v.location_id, v.category, v.category_slug, v.subcategory, v.subcategory_slug, v.pricing_model,
    v.unit, v.sell_by, v.unit_price_cents, v.estimated_weight_lb, v.weight_step_lb, v.min_weight_lb,
    v.tax_code, v.deposit_cents, v.min_qty, v.max_qty, v.available_days, v.organic, v.dietary_claims,
    v.nutrition_label, v.disclaimer, v.pickup_only, v.updated_at,
    COALESCE((SELECT json_agg(json_build_object('sale_price_cents', pr.sale_price_cents, 'label', pr.label,
                'starts_at', pr.starts_at, 'ends_at', pr.ends_at))
              FROM catalog.promotions pr
              WHERE pr.product_id = v.id AND (pr.ends_at IS NULL OR pr.ends_at > now())),
             '[]'::json) AS promotions
  FROM catalog.product_view v`

function promotionsOf(row: ProductRow) {
  return row.promotions.map((pr) => ({
    salePriceCents: Number(pr.sale_price_cents),
    label: pr.label,
    startsAt: pr.starts_at ? new Date(pr.starts_at) : null,
    endsAt: pr.ends_at ? new Date(pr.ends_at) : null,
  }))
}

function toSummary(row: ProductRow, now: Date): ProductSummary {
  const unitPriceCents = Number(row.unit_price_cents)
  const best = effectivePrice({ unitPriceCents, promotions: promotionsOf(row) }, now)
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    name: row.name,
    brand: row.brand,
    upc: row.upc,
    description: row.description,
    currency: row.currency,
    sku: row.sku,
    availability: row.availability,
    isVisible: row.is_visible,
    images: row.images,
    merchantId: Number(row.merchant_id),
    merchantSlug: row.merchant_slug,
    merchantName: row.merchant_name,
    category: row.category,
    categorySlug: row.category_slug,
    subcategory: row.subcategory,
    subcategorySlug: row.subcategory_slug,
    pricingModel: row.pricing_model,
    unit: row.unit,
    sellBy: row.sell_by,
    unitPriceCents,
    effectivePriceCents: best.unitPriceCents,
    promoLabel: best.promoLabel,
    onSale: best.unitPriceCents < unitPriceCents,
    comparisonPrice: comparisonPrice(row.name, best.unitPriceCents, row.pricing_model),
    estimatedWeightLb: row.estimated_weight_lb,
    weightStepLb: row.weight_step_lb,
    minWeightLb: row.min_weight_lb,
    taxCode: row.tax_code,
    depositCents: Number(row.deposit_cents),
    minQty: row.min_qty,
    maxQty: row.max_qty,
    availableDays: row.available_days.map(Number),
    organic: row.organic,
    dietaryClaims: row.dietary_claims,
    nutritionLabel: row.nutrition_label,
    disclaimer: row.disclaimer,
    pickupOnly: row.pickup_only,
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export async function getProductsByIds(ids: string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return []
  const { rows } = await getDb().query<ProductRow>(
    `${PRODUCT_SELECT} WHERE v.id = ANY($1::text[]) AND v.deleted_at IS NULL`,
    [ids],
  )
  const now = new Date()
  const byId = new Map(rows.map((r) => [r.id, toSummary(r, now)]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export interface ResolvedProduct {
  product: ProductSummary

  redirect: boolean
}

export async function resolveProduct(param: string): Promise<ResolvedProduct | null> {
  const { rows } = await getDb().query<ProductRow>(
    `${PRODUCT_SELECT}
     WHERE v.is_visible AND (v.slug = $1 OR v.id = $1
       OR v.id = (SELECT product_id FROM catalog.product_slug_history WHERE slug = $1))
     ORDER BY (v.slug = $1) DESC LIMIT 1`,
    [param],
  )
  if (!rows[0]) return null
  const product = toSummary(rows[0], new Date())
  return { product, redirect: product.slug !== param }
}

export async function getProduct(idOrSlug: string): Promise<ProductSummary | null> {
  return (await resolveProduct(idOrSlug))?.product ?? null
}

export interface CategoryNode {
  id: number
  name: string
  slug: string
  productCount: number
  subcategories: Array<{ id: number; name: string; slug: string; productCount: number }>
}

export async function listCategories(): Promise<CategoryNode[]> {
  const { rows } = await getDb().query<{
    category_id: string
    category: string
    category_slug: string
    category_order: number
    subcategory_id: string
    subcategory: string
    subcategory_slug: string
    n: string
  }>(
    `SELECT c.id AS category_id, c.name AS category, c.slug AS category_slug, c.sort_order AS category_order,
            s.id AS subcategory_id, s.name AS subcategory, s.slug AS subcategory_slug, count(*) AS n
     FROM catalog.product_view v
     JOIN catalog.subcategories s ON s.id = v.subcategory_id
     JOIN catalog.categories c ON c.id = s.category_id
     WHERE v.is_visible AND c.slug IS NOT NULL AND s.slug IS NOT NULL
     GROUP BY c.id, s.id
     ORDER BY c.sort_order, c.name, s.sort_order, s.name`,
  )
  const tree = new Map<number, CategoryNode>()
  for (const r of rows) {
    const id = Number(r.category_id)
    let node = tree.get(id)
    if (!node) {
      node = { id, name: r.category, slug: r.category_slug, productCount: 0, subcategories: [] }
      tree.set(id, node)
    }
    node.productCount += Number(r.n)
    node.subcategories.push({
      id: Number(r.subcategory_id),
      name: r.subcategory,
      slug: r.subcategory_slug,
      productCount: Number(r.n),
    })
  }
  return [...tree.values()]
}

export interface MerchantStorefront {
  id: number
  slug: string
  name: string
  minOrderCents: number
  acceptingOrders: boolean
  productCount: number
  locations: Array<{
    slug: string
    name: string
    addressLine1: string | null
    city: string | null
    province: string | null
    postalCode: string | null
  }>
}

export async function listMerchants(slug?: string): Promise<MerchantStorefront[]> {
  const { rows } = await getDb().query<{
    id: string
    slug: string
    name: string
    min_order_cents: string
    accepting_orders: boolean
    product_count: string
    locations: MerchantStorefront['locations']
  }>(
    `SELECT m.id, m.slug, m.name, m.min_order_cents, m.accepting_orders,
       (SELECT count(*) FROM catalog.product_view v WHERE v.merchant_id = m.id AND v.is_visible) AS product_count,
       COALESCE((SELECT json_agg(json_build_object('slug', l.slug, 'name', l.name,
                   'addressLine1', l.address_line1, 'city', l.city, 'province', l.province,
                   'postalCode', l.postal_code) ORDER BY l.name)
                 FROM merchant.locations l WHERE l.merchant_id = m.id), '[]'::json) AS locations
     FROM merchant.merchants m
     WHERE m.storefront_visible AND ($1::text IS NULL OR m.slug = $1)
     ORDER BY m.name`,
    [slug ?? null],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    minOrderCents: Number(r.min_order_cents),
    acceptingOrders: r.accepting_orders,
    productCount: Number(r.product_count),
    locations: r.locations,
  }))
}

export async function getPricingProducts(ids: string[]): Promise<PricingProduct[]> {
  if (ids.length === 0) return []
  const { rows } = await getDb().query<ProductRow>(
    `${PRODUCT_SELECT} WHERE v.id = ANY($1::text[])`,
    [ids],
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    merchantId: Number(r.merchant_id),
    locationId: Number(r.location_id),

    available:
      r.is_visible && r.availability === 'in_stock' && r.currency.trim().toUpperCase() === 'CAD',
    pricingModel: r.pricing_model,
    sellBy: r.sell_by,
    unitPriceCents: Number(r.unit_price_cents),
    promotions: promotionsOf(r),
    estimatedWeightMlb: r.estimated_weight_lb ? lbToMlb(r.estimated_weight_lb) : null,
    weightStepMlb: lbToMlb(r.weight_step_lb),
    minWeightMlb: lbToMlb(r.min_weight_lb),
    taxCode: r.tax_code,
    depositCents: Number(r.deposit_cents),
    minQty: r.min_qty,
    maxQty: r.max_qty,
  }))
}

export async function getProductOwner(
  id: string,
): Promise<{ merchantId: number; locationId: number } | null> {
  const { rows } = await getDb().query<{ merchant_id: string; location_id: string }>(
    'SELECT merchant_id, location_id FROM catalog.products WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  return rows[0]
    ? { merchantId: Number(rows[0].merchant_id), locationId: Number(rows[0].location_id) }
    : null
}

export async function listProductSlugs(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  const { rows } = await getDb().query<{ slug: string; updated_at: Date }>(
    `SELECT slug, updated_at FROM catalog.product_view WHERE is_visible AND slug IS NOT NULL ORDER BY slug`,
  )
  return rows.map((r) => ({ slug: r.slug, updatedAt: new Date(r.updated_at) }))
}

export async function getProductsByUpc(
  merchantId: number,
  upcs: string[],
): Promise<ProductSummary[]> {
  if (upcs.length === 0) return []
  const { rows } = await getDb().query<ProductRow>(
    `${PRODUCT_SELECT} WHERE v.merchant_id = $1 AND v.upc = ANY($2::text[])`,
    [merchantId, upcs],
  )
  const now = new Date()
  return rows.map((r) => toSummary(r, now))
}

export async function suggestReplacements(productId: string, limit = 5): Promise<ProductSummary[]> {
  const { rows } = await getDb().query<ProductRow>(
    `${PRODUCT_SELECT}
     JOIN catalog.product_view o ON o.id = $1
     WHERE v.merchant_id = o.merchant_id AND v.subcategory_id = o.subcategory_id AND v.id <> o.id
       AND v.is_visible AND v.availability = 'in_stock'
     ORDER BY abs(v.unit_price_cents - o.unit_price_cents), v.id
     LIMIT $2`,
    [productId, limit],
  )
  const now = new Date()
  return rows.map((r) => toSummary(r, now))
}
