import { scanForOrder } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams, scanBody } from '../../../_lib/schemas'

export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  const body = await parseJson(ctx.req, scanBody)
  return scanForOrder(scopeOf(ctx), publicId, body.code)
})
