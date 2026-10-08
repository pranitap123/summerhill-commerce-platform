import { NextResponse, type NextRequest } from 'next/server'
import {
  CART_COOKIE,
  cartIdFromCookie,
  getCartItems,
  quoteCart,
  type Cart,
  type CartContext,
} from '@/modules/cart'
import { getProductsByIds } from '@/modules/catalog'
import type { SessionUser } from '@/modules/identity'
import { toPublicQuote, type PublicQuote, type QuoteLine } from '@/modules/pricing'
import { getConfig } from '@/server/config'

export function cartContext(req: NextRequest, user: SessionUser | null): CartContext {
  return { user, cookieCartId: cartIdFromCookie(req.cookies.get(CART_COOKIE)?.value) }
}

export function withCartCookie<T extends NextResponse>(res: T, value: string | undefined): T {
  if (value === undefined) return res
  res.cookies.set(CART_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().isProduction,
    path: '/',
    maxAge: value ? 30 * 86_400 : 0,
  })
  return res
}

export const toMlb = (lb: number | null | undefined) =>
  lb === null || lb === undefined ? lb : Math.round(lb * 1000)

export interface CartItemView {
  id: number
  productId: string
  name: string
  image: string | null
  pricingModel: 'each' | 'per_weight' | null
  sellBy: 'quantity' | 'weight' | null
  unit: 'ea' | 'lb' | null
  quantity: number | null
  weightLb: number | null
  unitPriceCents: number | null
  effectivePriceCents: number | null
  promoLabel: string | null
  replacementPreference: 'best_match' | 'specific' | 'refund'
  replacementProductIds: string[]
  note: string | null
  available: boolean
  line: QuoteLine | null
}

export interface CartView {
  cart: { id: string; merchantId: number | null; items: CartItemView[] } | null
  quote: PublicQuote | null
}

export async function cartView(cart: Cart | null): Promise<CartView> {
  if (!cart) return { cart: null, quote: null }
  const { quote } = await quoteCart(cart)
  const items = await getCartItems(cart.id)
  const products = new Map(
    (await getProductsByIds(items.map((i) => i.productId))).map((p) => [p.id, p]),
  )
  const lines = new Map(quote.lines.map((l) => [l.productId, l]))
  return {
    cart: {
      id: cart.id,
      merchantId: cart.merchantId,
      items: items.map((i) => {
        const p = products.get(i.productId)
        return {
          id: i.id,
          productId: i.productId,
          name: p?.name ?? 'Unavailable item',
          image: p?.images[0] ?? null,
          pricingModel: p?.pricingModel ?? null,
          sellBy: p?.sellBy ?? null,
          unit: p?.unit ?? null,
          quantity: i.quantity,
          weightLb: i.weightMlb === null ? null : i.weightMlb / 1000,
          unitPriceCents: p?.unitPriceCents ?? null,
          effectivePriceCents: p?.effectivePriceCents ?? null,
          promoLabel: p?.promoLabel ?? null,
          replacementPreference: i.replacementPreference,
          replacementProductIds: i.replacementProductIds,
          note: i.note,
          available: p?.availability === 'in_stock',
          line: lines.get(i.productId) ?? null,
        }
      }),
    },
    quote: toPublicQuote(quote),
  }
}
