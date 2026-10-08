import { NextResponse } from 'next/server'

import { resolveCart } from '@/modules/cart'
import { consume, LIMITS, readIdempotencyKey, requestHash, withIdempotency } from '@/modules/ops'
import { startCheckout } from '@/modules/payments'
import { clientIp, HttpError, parseJson, route } from '@/server/http'

import { cartContext, withCartCookie } from '../_lib/cart'
import { checkoutBody } from '../_lib/schemas'

export const POST = route(
  'public',
  async ({ req, user, requestId }) => {
    const key = readIdempotencyKey(req.headers)
    await consume(LIMITS.checkout, clientIp(req) ?? 'unknown')
    const body = await parseJson(req, checkoutBody)
    const email = user?.email || body.email
    if (!email)
      throw new HttpError(
        400,
        'VALIDATION_FAILED',
        'An email address is required for guest checkout',
      )

    const ctx = cartContext(req, user)
    const caller = user ? `user:${user.id}` : `cart:${ctx.cookieCartId ?? 'none'}`
    let setCookie: string | undefined
    const result = await withIdempotency(
      `checkout:${caller}`,
      key,
      requestHash({ ...body, email }),
      async () => {
        const resolved = await resolveCart(ctx)
        setCookie = resolved.setCookie
        if (!resolved.cart) throw new HttpError(422, 'CART_INVALID', 'Your cart is empty')
        const r = await startCheckout({
          cart: resolved.cart,
          user,
          email,
          pickupName: body.pickupName ?? null,
          quoteHash: body.quoteHash,
          slotId: body.slotId,
          requestId,
        })
        return {
          status: 201,
          body: {
            publicId: r.publicId,
            checkoutUrl: r.checkoutUrl,
            orderUrl: `/orders/${r.publicId}?t=${encodeURIComponent(r.accessToken)}`,
          },
        }
      },
    )
    const res = NextResponse.json(result.body, { status: result.status })
    if (result.replayed) res.headers.set('idempotent-replayed', 'true')
    return withCartCookie(res, setCookie)
  },
  { session: 'optional' },
)
