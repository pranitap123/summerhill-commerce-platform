import { requireRole, staffActor } from '@/modules/fulfilment'
import { addClosure, getLocationSettings } from '@/modules/scheduling'
import { HttpError, parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { closureBody, locationParams } from '../../../_lib/schemas'

export const POST = route<{ id: string }>('staff', async (ctx) => {
  const { id } = parseParams(ctx.params, locationParams)
  const settings = await getLocationSettings(id)
  if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
  const scope = scopeOf(ctx)
  requireRole(scope, settings, 'owner', 'Location not found')
  const body = await parseJson(ctx.req, closureBody)
  return {
    closures: await addClosure(id, body, staffActor(scope), { requestId: ctx.requestId }),
  }
})
