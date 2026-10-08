import { rateOrder } from '@/modules/fulfilment'
import { getOrder } from '@/modules/ordering'
import { parseJson, parseParams, parseQuery, route } from '@/server/http'

import { customerActor, orderView, viewableOrder } from '../../../_lib/orders'
import { orderQuery, publicIdParams, ratingBody } from '../../../_lib/schemas'

export const POST = route<{ publicId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const body = await parseJson(req, ratingBody)
    const order = await viewableOrder(publicId, user, t)
    await rateOrder(
      order,
      { rating: body.rating, tags: body.tags, comment: body.comment ?? null },
      customerActor(user),
    )
    return orderView((await getOrder(order.id))!)
  },
  { session: 'optional' },
)
