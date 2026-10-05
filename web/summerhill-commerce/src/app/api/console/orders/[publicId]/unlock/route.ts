import { unlockHandover } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams } from '../../../_lib/schemas'

/** POST …/unlock: a manager unlocks a handover after too many wrong codes (G4-14). */
export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  return unlockHandover(scopeOf(ctx), publicId, ctx.requestId)
})
