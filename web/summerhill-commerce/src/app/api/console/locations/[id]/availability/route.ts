import { availabilityToggles } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { locationParams } from '../../../_lib/schemas'

/** GET /api/console/locations/{id}/availability: what is switched off for today (G4-20). */
export const GET = route<{ id: string }>('staff', async (ctx) => {
  const { id } = parseParams(ctx.params, locationParams)
  return availabilityToggles(scopeOf(ctx), id)
})
