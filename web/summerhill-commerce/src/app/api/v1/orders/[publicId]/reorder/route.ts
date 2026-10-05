import { NextResponse } from 'next/server'

import { reorder } from '@/modules/fulfilment'
import { parseJson, parseParams, parseQuery, route } from '@/server/http'

import { cartContext, cartView, withCartCookie } from '../../../_lib/cart'
import { viewableOrder } from '../../../_lib/orders'
import { orderQuery, publicIdParams, reorderBody } from '../../../_lib/schemas'

/**
 * POST /api/v1/orders/{publicId}/reorder?t=… (G4-19): buy again. Adds every product still sold
 * to the cart and reports the ones that aren't. 409 CART_MIXED_MERCHANTS when the cart holds
 * another store's items (retry with replaceCart: the current cart is saved).
 */
export const POST = route<{ publicId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const body = await parseJson(req, reorderBody)
    const order = await viewableOrder(publicId, user, t)
    const result = await reorder(order, cartContext(req, user), body)
    const res = NextResponse.json({
      added: result.added,
      unavailable: result.unavailable,
      ...(await cartView(result.resolved.cart)),
    })
    return withCartCookie(res, result.resolved.setCookie)
  },
  { session: 'optional' },
)
