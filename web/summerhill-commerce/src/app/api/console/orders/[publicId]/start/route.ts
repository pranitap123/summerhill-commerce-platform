import { startPicking } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { orderParams, startBody } from '../../../_lib/schemas'

/** POST …/start: claim the order for picking; `takeover` confirms taking it from another picker (G4-08). */
export const POST = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  const body = await parseJson(ctx.req, startBody)
  return startPicking(scopeOf(ctx), publicId, { takeover: body.takeover, requestId: ctx.requestId })
})
