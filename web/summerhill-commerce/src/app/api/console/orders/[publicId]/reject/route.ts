import { rejectOrder } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams, rejectBody } from '../../../_lib/schemas'

export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  const body = await parseJson(ctx.req, rejectBody)
  return rejectOrder(scopeOf(ctx), publicId, body.reason, ctx.requestId)
})
