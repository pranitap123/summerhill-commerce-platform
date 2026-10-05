import { cancelOnBehalf } from '@/modules/payments'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { refundLimitFor } from '../../../_lib/helpers'
import { cancelBody } from '../../../_lib/schemas'

/**
 * POST /api/admin/orders/{id}/cancel (A7, ORDERS §8): cancel on the customer's behalf. Before
 * capture the card hold is voided; a charged order that wasn't collected is refunded in full
 * (liability required) and cancelled. Support's refund limit applies. Audited.
 */
export const POST = route<{ id: string }>(
  'admin',
  async ({ req, params, user, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const body = await parseJson(req, cancelBody)
    const { order, refund } = await cancelOnBehalf(auditContext, id, {
      reason: body.reason,
      liability: body.liability,
      limitCents: refundLimitFor(user),
    })
    return { publicId: order.publicId, status: order.status, refund }
  },
  { permission: 'orders.cancel', audit: 'service' },
)
