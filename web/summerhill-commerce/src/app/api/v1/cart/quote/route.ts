import { NextResponse } from 'next/server'

import { resolveCart } from '@/modules/cart'
import { route } from '@/server/http'

import { cartContext, cartView, withCartCookie } from '../../_lib/cart'

/**
 * POST /api/v1/cart/quote: the full price breakdown (items, promotions, deposits, HST, weight
 * buffer, total hold). Its `hash` is what /api/v1/checkout accepts for the next 10 minutes.
 */
export const POST = route(
  'public',
  async ({ req, user }) => {
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    return withCartCookie(NextResponse.json(await cartView(cart)), setCookie)
  },
  { session: 'optional' },
)
