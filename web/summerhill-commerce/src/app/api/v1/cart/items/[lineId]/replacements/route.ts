import { NextResponse } from 'next/server'

import { getCartItems, resolveCart } from '@/modules/cart'
import { suggestReplacements } from '@/modules/catalog'
import { HttpError, parseParams, route } from '@/server/http'

import { cartContext, withCartCookie } from '../../../../_lib/cart'
import { lineIdParams } from '../../../../_lib/schemas'

/**
 * GET /api/v1/cart/items/{lineId}/replacements (G4-04): products the customer can rank as
 * specific replacements (same store and subcategory, closest in price).
 */
export const GET = route<{ lineId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { lineId } = parseParams(params, lineIdParams)
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    const item = cart ? (await getCartItems(cart.id)).find((i) => i.id === lineId) : undefined
    if (!item) throw new HttpError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found')
    const options = await suggestReplacements(item.productId, 8)
    return withCartCookie(
      NextResponse.json({
        selected: item.replacementProductIds,
        options: options.map((p) => ({
          productId: p.id,
          name: p.name,
          image: p.images[0] ?? null,
          effectivePriceCents: p.effectivePriceCents,
          unit: p.unit,
        })),
      }),
      setCookie,
    )
  },
  { session: 'optional' },
)
