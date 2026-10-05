import { requestPayout } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { payoutBody } from '../../../_lib/schemas'

/**
 * POST /api/admin/merchants/{id}/payout (G5-07): a manual payout from the merchant's available
 * balance. Needs an Idempotency-Key and a reason; above $5,000 it waits for a second approver.
 */
export const POST = route<{ id: string }>(
  'admin',
  async (ctx) => {
    const { id } = parseParams(ctx.params, idParam)
    const body = await parseJson(ctx.req, payoutBody)
    return moneyAction(ctx, `payout:${id}`, body, () =>
      requestPayout(ctx.auditContext, { merchantId: id, ...body }),
    )
  },
  { permission: 'payouts.manage', audit: 'service' },
)
