import { cancelByCustomer } from '@/modules/fulfilment'
import { parseParams, parseQuery, route } from '@/server/http'

import { customerActor, orderView, viewableOrder } from '../../../_lib/orders'
import { orderQuery, publicIdParams } from '../../../_lib/schemas'

export const POST = route<{ publicId: string }>(
  'public',
  async ({ req, user, params, requestId }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const order = await viewableOrder(publicId, user, t)
    return orderView(await cancelByCustomer(order, customerActor(user), requestId))
  },
  { session: 'optional' },
)
