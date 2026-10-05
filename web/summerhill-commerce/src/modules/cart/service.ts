import { getPricingProducts, getProductOwner, getProductsByIds } from '@/modules/catalog'
import type { SessionUser } from '@/modules/identity'
import { getMerchantById } from '@/modules/merchant'
import {
  buildQuote,
  getActiveFeeSchedule,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  type Quote,
} from '@/modules/pricing'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { sign, unsign } from '@/server/signing'

import {
  countItems,
  createCart,
  deleteItem,
  getActiveCart,
  getActiveCartForUser,
  getCartItems,
  markQuoted,
  setCartMerchant,
  setCartOwner,
  setCartStatus,
  touchCart,
  upsertItem,
  type Cart,
  type CartItem,
  type ReplacementPreference,
} from './repository'

/**
 * Server-side cart (G2-06, ORDERS §1). Keyed by the signed-in user, or by a signed anonymous
 * cookie. The browser only mirrors it. One merchant per cart; signing in merges the anonymous
 * cart into the customer's cart.
 */
export const CART_COOKIE = 'cart'
export const QUOTE_MAX_AGE_MS = 10 * 60_000

export function cartCookieValue(cartId: string): string {
  return sign('cart-cookie', cartId)
}
export function cartIdFromCookie(value: string | null | undefined): string | null {
  const id = unsign('cart-cookie', value)
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null
}

const userKey = (user: SessionUser) => String(user.id)

export interface CartContext {
  user: SessionUser | null
  cookieCartId: string | null
}

export interface ResolvedCart {
  cart: Cart | null
  /** Cookie value to set (a new anonymous cart), or '' to clear it after a merge. */
  setCookie?: string
}

/**
 * Finds the caller's cart. With a session and an anonymous cookie cart, the anonymous lines are
 * merged in (the larger quantity wins on duplicates); if the carts belong to different merchants,
 * the more recently updated one stays active and the other is saved.
 */
export async function resolveCart(ctx: CartContext, create = false): Promise<ResolvedCart> {
  const anon = ctx.cookieCartId ? await getActiveCart(ctx.cookieCartId) : null
  const anonCart = anon && anon.userId === null ? anon : null

  if (!ctx.user) {
    if (anonCart) return { cart: anonCart }
    if (!create) return { cart: null }
    const cart = await createCart(null)
    return { cart, setCookie: cartCookieValue(cart.id) }
  }

  const userId = userKey(ctx.user)
  const own = await getActiveCartForUser(userId)
  if (anonCart) {
    const merged = await withTransaction((tx) => mergeCarts(tx, anonCart, own, userId))
    return { cart: merged, setCookie: '' }
  }
  if (own || !create) return { cart: own }
  return { cart: await createCart(userId) }
}

async function mergeCarts(tx: Db, anon: Cart, own: Cart | null, userId: string): Promise<Cart> {
  if (!own) {
    await setCartOwner(tx, anon.id, userId)
    return { ...anon, userId }
  }
  const anonItems = await getCartItems(anon.id, tx)
  if (anonItems.length === 0) {
    await setCartStatus(tx, anon.id, 'merged')
    return own
  }
  if (own.merchantId !== null && anon.merchantId !== null && own.merchantId !== anon.merchantId) {
    // Different stores: keep the most recent cart active, save the other.
    const [winner, loser] = anon.updatedAt > own.updatedAt ? [anon, own] : [own, anon]
    await setCartStatus(tx, loser.id, 'saved')
    if (winner.id === anon.id) await setCartOwner(tx, anon.id, userId)
    return { ...winner, userId }
  }
  const ownItems = new Map((await getCartItems(own.id, tx)).map((i) => [i.productId, i]))
  for (const item of anonItems) {
    const existing = ownItems.get(item.productId)
    await upsertItem(tx, own.id, item.productId, {
      quantity: maxOrNull(existing?.quantity ?? null, item.quantity),
      weightMlb: maxOrNull(existing?.weightMlb ?? null, item.weightMlb),
      replacementPreference: item.replacementPreference,
      replacementProductIds: item.replacementProductIds,
      note: item.note,
    })
  }
  if (own.merchantId === null && anon.merchantId !== null)
    await setCartMerchant(tx, own.id, { merchantId: anon.merchantId, locationId: anon.locationId! })
  await touchCart(tx, own.id)
  await setCartStatus(tx, anon.id, 'merged')
  return (await getActiveCart(own.id, tx))!
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

export interface ItemInput {
  productId: string
  quantity?: number | null
  weightMlb?: number | null
  replacementPreference?: ReplacementPreference
  replacementProductIds?: string[]
  note?: string | null
}

/**
 * Adds a product (or adds to its quantity). A product from another merchant is refused with
 * 409 CART_MIXED_MERCHANTS unless `replaceCart` is set, in which case the current cart is saved
 * and a new one started ("Start a new cart? Your cart from X will be saved.").
 */
export async function addItem(
  ctx: CartContext,
  input: ItemInput & { replaceCart?: boolean },
): Promise<ResolvedCart & { item: CartItem }> {
  const owner = await getProductOwner(input.productId)
  if (!owner) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found')
  let resolved = await resolveCart(ctx, true)
  let cart = resolved.cart!

  if (cart.merchantId !== null && cart.merchantId !== owner.merchantId) {
    if (!input.replaceCart)
      throw new HttpError(
        409,
        'CART_MIXED_MERCHANTS',
        'Your cart has items from another store. Start a new cart? Your current cart will be saved.',
        { cartMerchantId: cart.merchantId, productMerchantId: owner.merchantId },
      )
    await setCartStatus(getDb(), cart.id, 'saved')
    const fresh = await createCart(cart.userId)
    resolved = {
      cart: fresh,
      setCookie: cart.userId ? resolved.setCookie : cartCookieValue(fresh.id),
    }
    cart = fresh
  }

  const replacement =
    input.replacementPreference !== undefined || input.replacementProductIds !== undefined
      ? await validateReplacement(
          input.productId,
          owner.merchantId,
          input.replacementPreference ?? 'specific',
          input.replacementProductIds ?? [],
        )
      : null
  const item = await withTransaction(async (tx) => {
    const existing = (await getCartItems(cart.id, tx)).find((i) => i.productId === input.productId)
    if (!existing && (await countItems(tx, cart.id)) >= MAX_CART_LINES)
      throw new HttpError(
        422,
        'TOO_MANY_LINES',
        `A cart can hold at most ${MAX_CART_LINES} different items`,
      )
    const quantity =
      input.quantity === undefined || input.quantity === null
        ? null
        : Math.min(MAX_QTY_PER_LINE, (existing?.quantity ?? 0) + input.quantity)
    if (cart.merchantId === null) await setCartMerchant(tx, cart.id, owner)
    const saved = await upsertItem(tx, cart.id, input.productId, {
      quantity,
      weightMlb: input.weightMlb ?? null,
      replacementPreference:
        replacement?.preference ??
        existing?.replacementPreference ??
        ctx.user?.defaultReplacementPreference ??
        'best_match',
      replacementProductIds: replacement?.productIds ?? existing?.replacementProductIds ?? [],
      note: input.note === undefined ? (existing?.note ?? null) : input.note,
    })
    await touchCart(tx, cart.id)
    return saved
  })
  return { ...resolved, cart: { ...cart, merchantId: owner.merchantId }, item }
}

/** Sets a line's values. Quantity 0 removes the line. */
export async function updateItem(
  cart: Cart,
  itemId: number,
  patch: Omit<ItemInput, 'productId'>,
): Promise<void> {
  const current = (await getCartItems(cart.id)).find((i) => i.id === itemId)
  if (!current) throw new HttpError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found')
  const replacement =
    (patch.replacementPreference !== undefined || patch.replacementProductIds !== undefined) &&
    cart.merchantId !== null
      ? await validateReplacement(
          current.productId,
          cart.merchantId,
          patch.replacementPreference ?? current.replacementPreference,
          patch.replacementProductIds ?? current.replacementProductIds,
        )
      : null
  await withTransaction(async (tx) => {
    const existing = (await getCartItems(cart.id, tx)).find((i) => i.id === itemId)
    if (!existing) throw new HttpError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found')
    if (patch.quantity === 0) {
      await removeLine(tx, cart, itemId)
      return
    }
    await upsertItem(tx, cart.id, existing.productId, {
      quantity: patch.quantity === undefined ? existing.quantity : patch.quantity,
      weightMlb: patch.weightMlb === undefined ? existing.weightMlb : patch.weightMlb,
      replacementPreference: replacement?.preference ?? existing.replacementPreference,
      replacementProductIds: replacement?.productIds ?? existing.replacementProductIds,
      note: patch.note === undefined ? existing.note : patch.note,
    })
    await touchCart(tx, cart.id)
  })
}

/**
 * Replacement preference of a line (G4-04, ORDERS §1): best match, refund, or up to 3 specific
 * products in ranked order. Specific choices must be other visible products of the same store;
 * for the other two preferences the list is cleared.
 */
export async function validateReplacement(
  productId: string,
  merchantId: number,
  preference: ReplacementPreference,
  productIds: string[],
): Promise<{ preference: ReplacementPreference; productIds: string[] }> {
  if (preference !== 'specific') return { preference, productIds: [] }
  const ranked = [...new Set(productIds)].filter((id) => id !== productId)
  if (ranked.length === 0 || ranked.length > 3)
    throw new HttpError(
      422,
      'REPLACEMENT_INVALID',
      'Choose between one and three replacement products',
    )
  const found = new Map((await getProductsByIds(ranked)).map((p) => [p.id, p]))
  const bad = ranked.filter((id) => {
    const p = found.get(id)
    return !p || !p.isVisible || p.merchantId !== merchantId
  })
  if (bad.length)
    throw new HttpError(
      422,
      'REPLACEMENT_INVALID',
      'Replacements must be other products from the same store',
      { productIds: bad },
    )
  return { preference, productIds: ranked }
}

export async function removeItem(cart: Cart, itemId: number): Promise<void> {
  await withTransaction(async (tx) => {
    if (!(await deleteItem(tx, cart.id, itemId)))
      throw new HttpError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found')
    await afterRemove(tx, cart)
  })
}

async function removeLine(tx: Db, cart: Cart, itemId: number) {
  await deleteItem(tx, cart.id, itemId)
  await afterRemove(tx, cart)
}

async function afterRemove(tx: Db, cart: Cart) {
  // An empty cart no longer belongs to a merchant, so any store's products can be added again.
  if ((await countItems(tx, cart.id)) === 0) await setCartMerchant(tx, cart.id, null)
  await touchCart(tx, cart.id)
}

/**
 * Prices the cart with the quote engine and remembers the quote hash and time; checkout accepts
 * only that hash, and only for QUOTE_MAX_AGE_MS.
 */
export async function quoteCart(
  cart: Cart,
  opts: { now?: Date; remember?: boolean } = {},
): Promise<{ quote: Quote; items: CartItem[] }> {
  const now = opts.now ?? new Date()
  const items = await getCartItems(cart.id)
  const products = await getPricingProducts(items.map((i) => i.productId))
  const merchant = cart.merchantId ? await getMerchantById(cart.merchantId) : null
  const feeSchedule = await getActiveFeeSchedule(cart.merchantId ?? 0, now)
  const quote = buildQuote(
    items.map((i) => ({ productId: i.productId, quantity: i.quantity, weightMlb: i.weightMlb })),
    products,
    {
      weightBufferBp: merchant?.weight_buffer_bp ?? 1500,
      minOrderCents: merchant?.min_order_cents ?? 0,
      feeSchedule,
      now,
    },
  )
  if (opts.remember !== false) await markQuoted(getDb(), cart.id, quote.hash)
  return { quote, items }
}

export async function markCartConverted(db: Db, cartId: string): Promise<void> {
  await setCartStatus(db, cartId, 'converted')
}

export { getActiveCart, getCartItems }
