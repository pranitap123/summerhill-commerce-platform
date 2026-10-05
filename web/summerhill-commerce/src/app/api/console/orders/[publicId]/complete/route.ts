import { completePicking } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams, completeBody } from '../../../_lib/schemas'

/** POST …/complete: picking done → the capture job charges the final amount (G4-13). */
export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  const body = await parseJson(ctx.req, completeBody)
  return completePicking(scopeOf(ctx), publicId, { ...body, requestId: ctx.requestId })
})
