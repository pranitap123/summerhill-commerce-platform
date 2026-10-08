import { NextResponse } from 'next/server'
import { removeItem, resolveCart, updateItem } from '@/modules/cart'
import { HttpError, parseJson, parseParams, route } from '@/server/http'

import { cartContext, cartView, toMlb, withCartCookie } from '../../../_lib/cart'
import { lineIdParams as params, updateItemBody } from '../../../_lib/schemas'

export const PATCH = route<{ lineId: string }>(
  'public',
  async ({ req, user, params: raw }) => {
    const { lineId } = parseParams(raw, params)
    const body = await parseJson(req, updateItemBody)
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    if (!cart) throw new HttpError(404, 'CART_NOT_FOUND', 'No cart')
    await updateItem(cart, lineId, { ...body, weightMlb: toMlb(body.weightLb) })
    return withCartCookie(NextResponse.json(await cartView(cart)), setCookie)
  },
  { session: 'optional' },
)

export const DELETE = route<{ lineId: string }>(
  'public',
  async ({ req, user, params: raw }) => {
    const { lineId } = parseParams(raw, params)
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    if (!cart) throw new HttpError(404, 'CART_NOT_FOUND', 'No cart')
    await removeItem(cart, lineId)
    return withCartCookie(NextResponse.json(await cartView(cart)), setCookie)
  },
  { session: 'optional' },
)
