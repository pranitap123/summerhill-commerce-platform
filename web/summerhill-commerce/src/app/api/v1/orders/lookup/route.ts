import { sendOrderLookupLink } from '@/modules/notifications'
import { consume, LIMITS } from '@/modules/ops'
import { findOrderForLookup } from '@/modules/ordering'
import { clientIp, parseJson, route } from '@/server/http'

import { lookupBody } from '../../_lib/schemas'

const RESPONSE = {
  ok: true,
  message: 'If an order matches those details, we have emailed a link to it.',
}

/**
 * POST /api/v1/orders/lookup (G2-20): a guest asks for a fresh link to their order. The response
 * is identical whether or not anything matched, the link goes only to the email on the order,
 * and requests are rate-limited per IP and per order id, so it can't be used to enumerate orders.
 */
export const POST = route('public', async ({ req, log }) => {
  await consume(LIMITS.orderLookup, `ip:${clientIp(req) ?? 'unknown'}`)
  const { publicId, email } = await parseJson(req, lookupBody)
  await consume(LIMITS.orderLookup, `order:${publicId}`)
  const order = await findOrderForLookup(publicId, email)
  if (order)
    await sendOrderLookupLink(order).catch((err) => log.error({ err }, 'lookup email failed'))
  return RESPONSE
})
