import { addItem, type CartContext, type ResolvedCart } from '@/modules/cart'
import { getProductsByIds } from '@/modules/catalog'
import { emit, type Actor } from '@/modules/ops'
import {
  getOrderForUpdate,
  getOrderLines,
  recordOrderEvent,
  setSubstituteDecision,
  type Order,
} from '@/modules/ordering'
import { voidOrder } from '@/modules/payments'
import { withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * What a customer can do with their order after paying (G4-12, G4-14, G4-15, G4-19). The caller
 * has already proven access to the order (owner session or signed guest link).
 */

/** Self-cancel before the store accepts (ORDERS §8): the card hold is voided and the slot freed. */
export async function cancelByCustomer(order: Order, actor: Actor, requestId: string | null) {
  if (order.status !== 'placed')
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      order.status === 'pending_payment'
        ? 'This order is still waiting for payment'
        : 'The store has already started on your order. Contact support to cancel it.',
      { status: order.status },
    )
  return voidOrder(order.id, actor, 'customer_cancelled', requestId)
}

/**
 * Approve or reject a substitute (G4-12). Allowed until picking completes; a rejected substitute
 * isn't charged (the line is refunded in effect). The customer may change their mind until then.
 */
export async function decideSubstitution(
  order: Order,
  substituteLineId: number,
  decision: 'approved' | 'rejected',
  actor: Actor,
) {
  await withTransaction(async (tx) => {
    const current = (await getOrderForUpdate(tx, order.id))!
    if (current.status !== 'picking' && current.status !== 'accepted')
      throw new HttpError(
        409,
        'PICKING_COMPLETE',
        'Your order has already been packed, so replacements can no longer be changed',
        { status: current.status },
      )
    const line = (await getOrderLines(order.id, tx)).find((l) => l.id === substituteLineId)
    if (!line || line.substitutesLineId === null)
      throw new HttpError(404, 'NOT_FOUND', 'Replacement not found')
    // A rejected substitute is `unavailable`; approving it again restores the pick.
    if (decision === 'approved' && line.customerDecision === 'rejected')
      await tx.query(`UPDATE commerce.order_lines SET status = 'picked' WHERE id = $1`, [line.id])
    await setSubstituteDecision(tx, line.id, decision)
    await recordOrderEvent(tx, order.id, 'substitution_decided', actor, {
      lineNo: line.lineNo,
      decision,
    })
    await emit(tx, 'order.substitution_decided', order.id, {
      orderId: order.id,
      lineId: line.id,
      decision,
    })
  })
}

const ARRIVAL_STATUSES = new Set(['accepted', 'picking', 'picked', 'ready', 'no_show'])

/** "I'm here" check-in (G4-14): shows on the console with an optional note (e.g. car colour). */
export async function markArrived(order: Order, note: string | null, actor: Actor) {
  if (!ARRIVAL_STATUSES.has(order.status))
    throw new HttpError(409, 'ORDER_STATE_CONFLICT', 'This order is not waiting for pickup', {
      status: order.status,
    })
  await withTransaction(async (tx) => {
    await tx.query(
      'UPDATE commerce.orders SET arrived_at = now(), arrival_note = $2 WHERE id = $1',
      [order.id, note],
    )
    await recordOrderEvent(tx, order.id, 'customer_arrived', actor, note ? { note } : {})
    await emit(tx, 'order.customer_arrived', order.id, { orderId: order.id })
  })
}

export const RATING_TAGS = [
  'fresh',
  'well_packed',
  'good_substitutes',
  'quick_pickup',
  'missing_items',
  'poor_substitutes',
  'damaged',
  'long_wait',
] as const
export type RatingTag = (typeof RATING_TAGS)[number]

/** Order rating after collection (G4-19, S14). Can be changed; stored for /ops. */
export async function rateOrder(
  order: Order,
  input: { rating: number; tags: RatingTag[]; comment: string | null },
  actor: Actor,
) {
  if (order.status !== 'collected')
    throw new HttpError(409, 'ORDER_STATE_CONFLICT', 'You can rate an order after picking it up')
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE commerce.orders SET rating = $2, rating_tags = $3, rating_comment = $4, rated_at = now()
       WHERE id = $1`,
      [order.id, input.rating, [...new Set(input.tags)], input.comment],
    )
    await recordOrderEvent(tx, order.id, 'rated', actor, { rating: input.rating, tags: input.tags })
  })
}

export interface ReorderResult {
  added: Array<{ productId: string; name: string }>
  unavailable: Array<{ productId: string; name: string }>
  resolved: ResolvedCart
}

/**
 * Buy again (G4-19, S14): adds the order's products (not substitutes) to the cart with the same
 * quantity or weight and replacement preference. Products no longer sold are reported, not added.
 */
export async function reorder(
  order: Order,
  ctx: CartContext,
  opts: { replaceCart?: boolean } = {},
): Promise<ReorderResult> {
  const lines = (await getOrderLines(order.id)).filter((l) => l.substitutesLineId === null)
  const products = new Map(
    (await getProductsByIds(lines.map((l) => l.productId))).map((p) => [p.id, p]),
  )
  const added: ReorderResult['added'] = []
  const unavailable: ReorderResult['unavailable'] = []
  let resolved: ResolvedCart = { cart: null }
  let replaceCart = opts.replaceCart ?? false
  let cartCtx = ctx
  for (const l of lines) {
    const p = products.get(l.productId)
    if (!p || !p.isVisible || p.availability !== 'in_stock') {
      unavailable.push({ productId: l.productId, name: l.name })
      continue
    }
    const item = {
      productId: l.productId,
      quantity: l.sellBy === 'weight' ? undefined : l.quantity,
      weightMlb: l.sellBy === 'weight' ? l.requestedWeightMlb : undefined,
      replacementPreference: l.replacementPreference,
      replacementProductIds: l.replacementPreference === 'specific' ? l.replacementProductIds : [],
      replaceCart,
    }
    const r = await addItem(cartCtx, item).catch((err: unknown) => {
      // Specific replacements that are no longer sold: fall back to "best match".
      if (err instanceof HttpError && err.code === 'REPLACEMENT_INVALID')
        return addItem(cartCtx, {
          ...item,
          replacementPreference: 'best_match',
          replacementProductIds: [],
        })
      throw err
    })
    replaceCart = false // only the first add may start a new cart
    if (r.setCookie !== undefined) resolved = { ...r, setCookie: r.setCookie }
    else resolved = { cart: r.cart, setCookie: resolved.setCookie }
    // Later adds must find the cart the first one created (anonymous carts live in the cookie).
    if (r.setCookie && r.cart) cartCtx = { ...cartCtx, cookieCartId: r.cart.id }
    added.push({ productId: l.productId, name: p.name })
  }
  return { added, unavailable, resolved }
}
