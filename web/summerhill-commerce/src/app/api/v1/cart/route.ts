import { NextResponse } from 'next/server'

import { resolveCart } from '@/modules/cart'
import { route } from '@/server/http'

import { cartContext, cartView, withCartCookie } from '../_lib/cart'

export const GET = route(
  'public',
  async ({ req, user }) => {
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    return withCartCookie(NextResponse.json(await cartView(cart)), setCookie)
  },
  { session: 'optional' },
)
