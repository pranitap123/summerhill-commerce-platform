import { pickLine } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../_lib/scope'
import { lineParams, pickBody } from '../../../../_lib/schemas'

/** POST …/lines/{lineId}: picked (quantity, weight, scan), unavailable, or reset (G4-09). */
export const POST = route<{ publicId: string; lineId: string }>('staff', async (ctx) => {
  const { publicId, lineId } = parseParams(ctx.params, lineParams)
  const body = await parseJson(ctx.req, pickBody)
  return pickLine(scopeOf(ctx), publicId, lineId, body)
})
