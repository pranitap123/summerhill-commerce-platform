import { acceptOrder } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams } from '../../../_lib/schemas'

/** POST …/accept: take a new order (G4-07). */
export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  return acceptOrder(scopeOf(ctx), publicId, ctx.requestId)
})
