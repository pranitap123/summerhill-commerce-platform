import { markArrived } from '@/modules/fulfilment'
import { getOrder } from '@/modules/ordering'
import { parseJson, parseParams, parseQuery, route } from '@/server/http'

import { customerActor, orderView, viewableOrder } from '../../../_lib/orders'
import { arrivedBody, orderQuery, publicIdParams } from '../../../_lib/schemas'

/** POST /api/v1/orders/{publicId}/arrived?t=… (G4-14): "I'm here", shown on the store console. */
export const POST = route<{ publicId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const { note } = await parseJson(req, arrivedBody)
    const order = await viewableOrder(publicId, user, t)
    await markArrived(order, note ?? null, customerActor(user))
    return orderView((await getOrder(order.id))!)
  },
  { session: 'optional' },
)
