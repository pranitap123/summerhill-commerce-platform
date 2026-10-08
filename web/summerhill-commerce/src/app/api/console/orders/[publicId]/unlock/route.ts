import { unlockHandover } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams } from '../../../_lib/schemas'

export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  return unlockHandover(scopeOf(ctx), publicId, ctx.requestId)
})
