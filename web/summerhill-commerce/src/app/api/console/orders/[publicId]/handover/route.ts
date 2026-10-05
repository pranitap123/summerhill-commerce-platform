import { handOver } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams, handoverBody } from '../../../_lib/schemas'

/** POST …/handover: check the pickup code the customer gives; five wrong codes lock the order (G4-14). */
export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  const body = await parseJson(ctx.req, handoverBody)
  return handOver(scopeOf(ctx), publicId, body.code, ctx.requestId)
})
