import { audit, emit, type Actor } from '@/modules/ops'
import { getDb, withTransaction } from '@/server/db'

export interface OverridePatch {
  hidden?: boolean

  hiddenUntil?: string | null
  name?: string | null
  subcategoryId?: number | null
  estimatedWeightLb?: string | null
  blockedReason?: string | null
}

export interface ProductOverride {
  productId: string
  hidden: boolean
  hiddenUntil: string | null
  name: string | null
  subcategoryId: number | null
  estimatedWeightLb: string | null
  blockedReason: string | null
  updatedBy: string
  updatedAt: string
}

export class OverrideTargetNotFound extends Error {}

const COLUMNS: Record<keyof OverridePatch, string> = {
  hidden: 'hidden',
  hiddenUntil: 'hidden_until',
  name: 'name',
  subcategoryId: 'subcategory_id',
  estimatedWeightLb: 'estimated_weight_lb',
  blockedReason: 'blocked_reason',
}

function toOverride(r: Record<string, unknown>): ProductOverride {
  return {
    productId: String(r.product_id),
    hidden: Boolean(r.hidden),
    hiddenUntil: r.hidden_until ? new Date(r.hidden_until as string).toISOString() : null,
    name: (r.name as string | null) ?? null,
    subcategoryId: r.subcategory_id === null ? null : Number(r.subcategory_id),
    estimatedWeightLb: (r.estimated_weight_lb as string | null) ?? null,
    blockedReason: (r.blocked_reason as string | null) ?? null,
    updatedBy: String(r.updated_by),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  }
}

export async function setProductOverride(
  productId: string,
  patch: OverridePatch,
  actor: Actor,
  requestId?: string,
): Promise<ProductOverride> {
  const keys = (Object.keys(patch) as Array<keyof OverridePatch>).filter(
    (k) => patch[k] !== undefined,
  )
  return withTransaction(async (tx) => {
    const exists = await tx.query(
      'SELECT 1 FROM catalog.products WHERE id = $1 AND deleted_at IS NULL',
      [productId],
    )
    if (!exists.rowCount) throw new OverrideTargetNotFound(productId)

    const cols = keys.map((k) => COLUMNS[k])
    const values = keys.map((k) => patch[k])
    const insertCols = ['product_id', 'updated_by', ...cols]
    const placeholders = insertCols.map((_, i) => `$${i + 1}`)
    const updates = ['updated_by = EXCLUDED.updated_by', ...cols.map((c) => `${c} = EXCLUDED.${c}`)]
    const { rows } = await tx.query(
      `INSERT INTO catalog.product_overrides (${insertCols.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (product_id) DO UPDATE SET ${updates.join(', ')}
       RETURNING *`,
      [productId, `${actor.type}:${actor.id ?? '-'}`, ...values],
    )
    await emit(tx, 'product.changed', productId, { productId, reason: 'override' })
    await audit(tx, {
      actor,
      action: 'catalog.override.set',
      targetType: 'product',
      targetId: productId,
      data: { patch },
      requestId,
    })
    return toOverride(rows[0])
  })
}

export async function clearProductOverride(
  productId: string,
  actor: Actor,
  requestId?: string,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      'DELETE FROM catalog.product_overrides WHERE product_id = $1',
      [productId],
    )
    if (!rowCount) return false
    await emit(tx, 'product.changed', productId, { productId, reason: 'override' })
    await audit(tx, {
      actor,
      action: 'catalog.override.clear',
      targetType: 'product',
      targetId: productId,
      requestId,
    })
    return true
  })
}

export async function getProductOverride(
  productId: string,
  db: { query: (q: string, v: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
): Promise<ProductOverride | null> {
  const { rows } = await db.query('SELECT * FROM catalog.product_overrides WHERE product_id = $1', [
    productId,
  ])
  return rows[0] ? toOverride(rows[0]) : null
}

export async function setCategoryAvailability(
  merchantId: number,
  categoryId: number,
  hiddenUntil: Date | null,
  actor: Actor,
  requestId?: string,
): Promise<number> {
  return withTransaction(async (tx) => {
    if (hiddenUntil)
      await tx.query(
        `INSERT INTO catalog.category_availability (merchant_id, category_id, hidden_until, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (merchant_id, category_id) DO UPDATE
           SET hidden_until = EXCLUDED.hidden_until, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [merchantId, categoryId, hiddenUntil, `${actor.type}:${actor.id ?? '-'}`],
      )
    else
      await tx.query(
        'DELETE FROM catalog.category_availability WHERE merchant_id = $1 AND category_id = $2',
        [merchantId, categoryId],
      )
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM catalog.product_view WHERE merchant_id = $1 AND category_id = $2
         AND deleted_at IS NULL`,
      [merchantId, categoryId],
    )
    for (const r of rows)
      await emit(tx, 'product.changed', r.id, { productId: r.id, reason: 'availability' })
    await audit(tx, {
      actor,
      action: hiddenUntil ? 'catalog.category.out_of_stock' : 'catalog.category.restocked',
      targetType: 'category',
      targetId: `${merchantId}:${categoryId}`,
      data: { hiddenUntil: hiddenUntil?.toISOString() ?? null, products: rows.length },
      requestId,
    })
    return rows.length
  })
}

export interface AvailabilityToggles {
  products: Array<{ productId: string; name: string; hiddenUntil: string }>
  categories: Array<{ categoryId: number; name: string; hiddenUntil: string }>
}

export async function listAvailabilityToggles(
  merchantId: number,
  now: Date = new Date(),
): Promise<AvailabilityToggles> {
  const db = getDb()
  const products = await db.query<{ id: string; name: string; hidden_until: Date }>(
    `SELECT p.id, COALESCE(o.name, p.name) AS name, o.hidden_until
     FROM catalog.product_overrides o JOIN catalog.products p ON p.id = o.product_id
     WHERE p.merchant_id = $1 AND o.hidden_until > $2 ORDER BY name`,
    [merchantId, now],
  )
  const categories = await db.query<{ category_id: string; name: string; hidden_until: Date }>(
    `SELECT ca.category_id, c.name, ca.hidden_until
     FROM catalog.category_availability ca JOIN catalog.categories c ON c.id = ca.category_id
     WHERE ca.merchant_id = $1 AND ca.hidden_until > $2 ORDER BY c.name`,
    [merchantId, now],
  )
  return {
    products: products.rows.map((r) => ({
      productId: r.id,
      name: r.name,
      hiddenUntil: new Date(r.hidden_until).toISOString(),
    })),
    categories: categories.rows.map((r) => ({
      categoryId: Number(r.category_id),
      name: r.name,
      hiddenUntil: new Date(r.hidden_until).toISOString(),
    })),
  }
}
