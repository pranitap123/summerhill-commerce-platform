import { setProductOutOfStockToday } from '@/modules/fulfilment'
import { parseJson, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../../_lib/scope'
import { availabilityBody, productAvailabilityParams } from '../../../../../_lib/schemas'

/** PUT …/availability/products/{productId}: "out of stock today" until the next opening (G4-20). */
export const PUT = route<{ id: string; productId: string }>('staff', async (ctx) => {
  const { id, productId } = parseParams(ctx.params, productAvailabilityParams)
  const { outOfStock } = await parseJson(ctx.req, availabilityBody)
  return setProductOutOfStockToday(scopeOf(ctx), id, productId, outOfStock, {
    requestId: ctx.requestId,
  })
})
