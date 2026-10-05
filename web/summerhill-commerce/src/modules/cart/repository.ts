import { lbToMlb, mlbToLb } from '@/modules/pricing'
import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

export type ReplacementPreference = 'best_match' | 'specific' | 'refund'

export interface Cart {
  id: string
  userId: string | null
  merchantId: number | null
  locationId: number | null
  status: 'active' | 'saved' | 'merged' | 'converted' | 'expired'
  lastQuoteHash: string | null
  lastQuotedAt: Date | null
  updatedAt: Date
}

export interface CartItem {
  id: number
  productId: string
  quantity: number | null
  weightMlb: number | null
  replacementPreference: ReplacementPreference
  replacementProductIds: string[]
  note: string | null
  updatedAt: Date
}

const CART_COLUMNS = `id, user_id, merchant_id, location_id, status, last_quote_hash, last_quoted_at, updated_at`

type Row = Record<string, unknown>
function toCart(r: Row): Cart {
  return {
    id: String(r.id),
    userId: (r.user_id as string) ?? null,
    merchantId: r.merchant_id === null ? null : Number(r.merchant_id),
    locationId: r.location_id === null ? null : Number(r.location_id),
    status: r.status as Cart['status'],
    lastQuoteHash: (r.last_quote_hash as string) ?? null,
    lastQuotedAt: (r.last_quoted_at as Date) ?? null,
    updatedAt: r.updated_at as Date,
  }
}
function toItem(r: Row): CartItem {
  return {
    id: Number(r.id),
    productId: String(r.product_id),
    quantity: r.quantity === null ? null : Number(r.quantity),
    weightMlb: r.requested_weight_lb === null ? null : lbToMlb(String(r.requested_weight_lb)),
    replacementPreference: r.replacement_preference as ReplacementPreference,
    replacementProductIds: (r.replacement_product_ids as string[]) ?? [],
    note: (r.note as string) ?? null,
    updatedAt: r.updated_at as Date,
  }
}

/** Carts untouched for this long are treated as expired (ORDERS §1). */
export const CART_TTL_DAYS = 30

export async function getActiveCart(id: string, db: Db = getDb()): Promise<Cart | null> {
  const { rows } = await db.query(
    `SELECT ${CART_COLUMNS} FROM commerce.carts
     WHERE id = $1 AND status = 'active' AND updated_at > now() - make_interval(days => $2)`,
    [id, CART_TTL_DAYS],
  )
  return rows[0] ? toCart(rows[0]) : null
}

export async function getActiveCartForUser(userId: string, db: Db = getDb()): Promise<Cart | null> {
  const { rows } = await db.query(
    `SELECT ${CART_COLUMNS} FROM commerce.carts WHERE user_id = $1 AND status = 'active'`,
    [userId],
  )
  return rows[0] ? toCart(rows[0]) : null
}

export async function createCart(userId: string | null, db: Db = getDb()): Promise<Cart> {
  const { rows } = await db.query(
    `INSERT INTO commerce.carts (user_id) VALUES ($1) RETURNING ${CART_COLUMNS}`,
    [userId],
  )
  return toCart(rows[0])
}

export async function setCartStatus(db: Db, cartId: string, status: Cart['status']): Promise<void> {
  await db.query('UPDATE commerce.carts SET status = $2 WHERE id = $1', [cartId, status])
}

export async function setCartOwner(db: Db, cartId: string, userId: string): Promise<void> {
  await db.query('UPDATE commerce.carts SET user_id = $2 WHERE id = $1', [cartId, userId])
}

export async function setCartMerchant(
  db: Db,
  cartId: string,
  merchant: { merchantId: number; locationId: number } | null,
): Promise<void> {
  await db.query(
    `UPDATE commerce.carts SET merchant_id = $2, location_id = $3, last_quote_hash = NULL
     WHERE id = $1`,
    [cartId, merchant?.merchantId ?? null, merchant?.locationId ?? null],
  )
}

/** Any change to the lines invalidates the last quote. */
export async function touchCart(db: Db, cartId: string): Promise<void> {
  await db.query(
    'UPDATE commerce.carts SET last_quote_hash = NULL, last_quoted_at = NULL WHERE id = $1',
    [cartId],
  )
}

export async function markQuoted(db: Db, cartId: string, hash: string): Promise<void> {
  await db.query(
    'UPDATE commerce.carts SET last_quote_hash = $2, last_quoted_at = now() WHERE id = $1',
    [cartId, hash],
  )
}

export async function getCartItems(cartId: string, db: Db = getDb()): Promise<CartItem[]> {
  const { rows } = await db.query(
    `SELECT id, product_id, quantity, requested_weight_lb, replacement_preference,
       replacement_product_ids, note, updated_at
     FROM commerce.cart_items WHERE cart_id = $1 ORDER BY id`,
    [cartId],
  )
  return rows.map(toItem)
}

export interface ItemValues {
  quantity: number | null
  weightMlb: number | null
  replacementPreference: ReplacementPreference
  replacementProductIds: string[]
  note: string | null
}

export async function upsertItem(
  db: Db,
  cartId: string,
  productId: string,
  v: ItemValues,
): Promise<CartItem> {
  const { rows } = await db.query(
    `INSERT INTO commerce.cart_items (cart_id, product_id, quantity, requested_weight_lb,
       replacement_preference, replacement_product_ids, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity,
       requested_weight_lb = EXCLUDED.requested_weight_lb,
       replacement_preference = EXCLUDED.replacement_preference,
       replacement_product_ids = EXCLUDED.replacement_product_ids, note = EXCLUDED.note
     RETURNING id, product_id, quantity, requested_weight_lb, replacement_preference,
       replacement_product_ids, note, updated_at`,
    [
      cartId,
      productId,
      v.quantity,
      v.weightMlb === null ? null : mlbToLb(v.weightMlb),
      v.replacementPreference,
      v.replacementProductIds,
      v.note,
    ],
  )
  return toItem(rows[0])
}

export async function deleteItem(db: Db, cartId: string, itemId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM commerce.cart_items WHERE cart_id = $1 AND id = $2',
    [cartId, itemId],
  )
  return !!rowCount
}

export async function countItems(db: Db, cartId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM commerce.cart_items WHERE cart_id = $1',
    [cartId],
  )
  return rows[0].n
}
