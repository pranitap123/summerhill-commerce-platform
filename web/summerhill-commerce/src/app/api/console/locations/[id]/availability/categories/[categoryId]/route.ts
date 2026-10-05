import { setCategoryOutOfStockToday } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../../_lib/scope'
import { availabilityBody, categoryAvailabilityParams } from '../../../../../_lib/schemas'

/** PUT …/availability/categories/{categoryId}: a whole category out of stock today (G4-20). */
export const PUT = route<{ id: string; categoryId: string }>('staff', async (ctx) => {
  const { id, categoryId } = parseParams(ctx.params, categoryAvailabilityParams)
  const { outOfStock } = await parseJson(ctx.req, availabilityBody)
  return setCategoryOutOfStockToday(scopeOf(ctx), id, categoryId, outOfStock, {
    requestId: ctx.requestId,
  })
})
