import { cancelOnBehalf } from '@/modules/payments'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { refundLimitFor } from '../../../_lib/helpers'
import { cancelBody } from '../../../_lib/schemas'

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
