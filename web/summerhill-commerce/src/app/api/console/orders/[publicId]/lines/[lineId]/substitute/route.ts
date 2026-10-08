import { substituteLine } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../../_lib/scope'
import { lineParams, substituteBody } from '../../../../../_lib/schemas'

export const POST = route<{ publicId: string; lineId: string }>('staff', async (ctx) => {
  const { publicId, lineId } = parseParams(ctx.params, lineParams)
  const body = await parseJson(ctx.req, substituteBody)
  return substituteLine(scopeOf(ctx), publicId, lineId, body)
})
