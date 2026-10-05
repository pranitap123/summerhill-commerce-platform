import { consoleOrder } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../_lib/scope'
import { orderParams } from '../../_lib/schemas'

/** GET /api/console/orders/{publicId}: the pick screen's data (G4-08). */
export const GET = route<{ publicId: string }>('staff', async (ctx) => {
  const { publicId } = parseParams(ctx.params, orderParams)
  return consoleOrder(scopeOf(ctx), publicId)
})
