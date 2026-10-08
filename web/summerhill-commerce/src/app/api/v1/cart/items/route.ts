import { NextResponse } from 'next/server'
import { addItem } from '@/modules/cart'
import { parseJson, route } from '@/server/http'

import { cartContext, cartView, toMlb, withCartCookie } from '../../_lib/cart'
import { addItemBody } from '../../_lib/schemas'

export const POST = route(
  'public',
  async ({ req, user }) => {
    const body = await parseJson(req, addItemBody)
    const { cart, setCookie } = await addItem(cartContext(req, user), {
      ...body,
      quantity: body.quantity ?? null,
      weightMlb: toMlb(body.weightLb) ?? null,
    })
    return withCartCookie(NextResponse.json(await cartView(cart), { status: 201 }), setCookie)
  },
  { session: 'optional' },
)
