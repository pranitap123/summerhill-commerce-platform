import { requireRole, staffActor } from '@/modules/fulfilment'
import { getLocationSettings, removeClosure } from '@/modules/scheduling'
import { HttpError, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../_lib/scope'
import { closureParams } from '../../../../_lib/schemas'

/** DELETE /api/console/locations/{id}/closures/{date}: reopen a closed day (owner only). */
export const DELETE = route<{ id: string; date: string }>('staff', async (ctx) => {
  const { id, date } = parseParams(ctx.params, closureParams)
  const settings = await getLocationSettings(id)
  if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
  const scope = scopeOf(ctx)
  requireRole(scope, settings, 'owner', 'Location not found')
  return {
    closures: await removeClosure(id, date, staffActor(scope), { requestId: ctx.requestId }),
  }
})
