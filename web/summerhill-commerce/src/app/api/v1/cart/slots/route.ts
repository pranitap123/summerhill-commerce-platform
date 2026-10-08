import { NextResponse } from 'next/server'

import { getCartItems, resolveCart } from '@/modules/cart'
import { getProductsByIds } from '@/modules/catalog'
import { availableSlots, getLocationSettings, listClosures } from '@/modules/scheduling'
import { route } from '@/server/http'

import { cartContext, withCartCookie } from '../../_lib/cart'

export const GET = route(
  'public',
  async ({ req, user }) => {
    const { cart, setCookie } = await resolveCart(cartContext(req, user))
    const empty = { timeZone: null, paused: false, leadTimeMinutes: null, slots: [] }
    if (!cart?.locationId) return withCartCookie(NextResponse.json(empty), setCookie)
    const settings = await getLocationSettings(cart.locationId)
    if (!settings) return withCartCookie(NextResponse.json(empty), setCookie)
    const items = await getCartItems(cart.id)
    const products = await getProductsByIds(items.map((i) => i.productId))
    const slots = await availableSlots(settings, await listClosures(settings.locationId), {
      now: new Date(),
      itemAvailableDays: products.map((p) => p.availableDays),
    })
    return withCartCookie(
      NextResponse.json({
        timeZone: settings.timeZone,
        paused: settings.paused,
        leadTimeMinutes: settings.leadTimeMinutes,
        slots: slots.map((s) => ({
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          remaining: s.remaining,
        })),
      }),
      setCookie,
    )
  },
  { session: 'optional' },
)
