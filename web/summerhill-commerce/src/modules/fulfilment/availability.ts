import {
  getProductsByIds,
  listAvailabilityToggles,
  setCategoryAvailability,
  setProductOverride,
} from '@/modules/catalog'
import { getLocationSettings, listClosures, nextOpening } from '@/modules/scheduling'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

import { requireRole, staffActor, type StaffScope } from './access'

async function merchantLocation(scope: StaffScope, locationId: number) {
  const settings = await getLocationSettings(locationId)
  if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
  requireRole(scope, settings, 'picker', 'Location not found')
  return settings
}

async function untilNextOpening(locationId: number, now: Date): Promise<Date> {
  const settings = (await getLocationSettings(locationId))!
  const closures = new Set((await listClosures(locationId)).map((c) => c.date))

  return nextOpening(settings, closures, now) ?? new Date(now.getTime() + 86_400_000)
}

export async function setProductOutOfStockToday(
  scope: StaffScope,
  locationId: number,
  productId: string,
  outOfStock: boolean,
  opts: { now?: Date; requestId?: string } = {},
) {
  const settings = await merchantLocation(scope, locationId)
  const [product] = await getProductsByIds([productId])
  if (!product || product.merchantId !== settings.merchantId)
    throw new HttpError(404, 'NOT_FOUND', 'Product not found')
  const hiddenUntil = outOfStock
    ? (await untilNextOpening(locationId, opts.now ?? new Date())).toISOString()
    : null
  await setProductOverride(productId, { hiddenUntil }, staffActor(scope), opts.requestId)
  return { productId, hiddenUntil }
}

export async function setCategoryOutOfStockToday(
  scope: StaffScope,
  locationId: number,
  categoryId: number,
  outOfStock: boolean,
  opts: { now?: Date; requestId?: string } = {},
) {
  const settings = await merchantLocation(scope, locationId)
  const { rowCount } = await getDb().query('SELECT 1 FROM catalog.categories WHERE id = $1', [
    categoryId,
  ])
  if (!rowCount) throw new HttpError(404, 'NOT_FOUND', 'Category not found')
  const hiddenUntil = outOfStock ? await untilNextOpening(locationId, opts.now ?? new Date()) : null
  const products = await setCategoryAvailability(
    settings.merchantId,
    categoryId,
    hiddenUntil,
    staffActor(scope),
    opts.requestId,
  )
  return { categoryId, hiddenUntil: hiddenUntil?.toISOString() ?? null, products }
}

export async function availabilityToggles(scope: StaffScope, locationId: number) {
  const settings = await merchantLocation(scope, locationId)
  const { rows } = await getDb().query<{ id: string; name: string; products: number }>(
    `SELECT c.id, c.name, count(v.id)::int AS products
     FROM catalog.categories c JOIN catalog.product_view v ON v.category_id = c.id
     WHERE v.merchant_id = $1 AND v.deleted_at IS NULL
     GROUP BY c.id, c.name, c.sort_order ORDER BY c.sort_order, c.name`,
    [settings.merchantId],
  )
  return {
    ...(await listAvailabilityToggles(settings.merchantId)),
    allCategories: rows.map((r) => ({
      categoryId: Number(r.id),
      name: r.name,
      products: r.products,
    })),
  }
}
