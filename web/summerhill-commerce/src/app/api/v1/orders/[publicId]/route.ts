import { canViewOrder, getOrderByPublicId } from '@/modules/ordering'
import { HttpError, parseParams, parseQuery, route } from '@/server/http'

import { orderView } from '../../_lib/orders'
import { orderQuery, publicIdParams } from '../../_lib/schemas'

/**
 * GET /api/v1/orders/{publicId}?t=… (G2-13): the order for its owner (session) or a guest holding
 * a valid signed link. Anyone else gets 404, the same as for an order that doesn't exist, so the
 * endpoint can't be used to discover order ids.
 */
export const GET = route<{ publicId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const order = await getOrderByPublicId(publicId)
    if (!order || !canViewOrder(order, user, t))
      throw new HttpError(404, 'NOT_FOUND', 'Order not found')
    return orderView(order)
  },
  { session: 'optional' },
)
