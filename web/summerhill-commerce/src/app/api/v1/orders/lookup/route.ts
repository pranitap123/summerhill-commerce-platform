import { sendOrderLookupLink } from '@/modules/notifications'
import { consume, LIMITS } from '@/modules/ops'
import { findOrderForLookup } from '@/modules/ordering'
import { clientIp, parseJson, route } from '@/server/http'

import { lookupBody } from '../../_lib/schemas'

const RESPONSE = {
  ok: true,
  message: 'If an order matches those details, we have emailed a link to it.',
}

export const POST = route('public', async ({ req, log }) => {
  await consume(LIMITS.orderLookup, `ip:${clientIp(req) ?? 'unknown'}`)
  const { publicId, email } = await parseJson(req, lookupBody)
  await consume(LIMITS.orderLookup, `order:${publicId}`)
  const order = await findOrderForLookup(publicId, email)
  if (order)
    await sendOrderLookupLink(order).catch((err) => log.error({ err }, 'lookup email failed'))
  return RESPONSE
})
