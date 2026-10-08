import { z } from 'zod'

import { simulateCheckout } from '@/modules/payments'
import { getConfig } from '@/server/config'
import { HttpError, parseJson, parseParams, route } from '@/server/http'

const params = z.object({ sessionId: z.string().regex(/^cs_sim_[0-9a-f]{24}$/) }).strict()
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pay'), cardNumber: z.string().trim().min(12).max(23) }).strict(),
  z.object({ action: z.literal('complete_3ds') }).strict(),
  z.object({ action: z.literal('fail_3ds') }).strict(),
])

export const POST = route<{ sessionId: string }>('public', async ({ req, params: raw }) => {
  const config = getConfig()
  if (config.PAYMENT_PROVIDER !== 'simulator') throw new HttpError(404, 'NOT_FOUND', 'Not found')
  const { sessionId } = parseParams(raw, params)
  return simulateCheckout(sessionId, await parseJson(req, body))
})
