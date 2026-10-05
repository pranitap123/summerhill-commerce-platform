import { decideSubstitution } from '@/modules/fulfilment'
import { getOrder } from '@/modules/ordering'
import { parseJson, parseParams, parseQuery, route } from '@/server/http'

import { customerActor, orderView, viewableOrder } from '../../../../_lib/orders'
import { orderLineParams, orderQuery, substitutionDecisionBody } from '../../../../_lib/schemas'

/**
 * POST /api/v1/orders/{publicId}/substitutions/{lineId}?t=… (G4-12): approve or reject a
 * replacement until picking completes. A rejected replacement isn't charged.
 */
export const POST = route<{ publicId: string; lineId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId, lineId } = parseParams(params, orderLineParams)
    const { t } = parseQuery(req, orderQuery)
    const { decision } = await parseJson(req, substitutionDecisionBody)
    const order = await viewableOrder(publicId, user, t)
    await decideSubstitution(order, lineId, decision, customerActor(user))
    return orderView((await getOrder(order.id))!)
  },
  { session: 'optional' },
)
