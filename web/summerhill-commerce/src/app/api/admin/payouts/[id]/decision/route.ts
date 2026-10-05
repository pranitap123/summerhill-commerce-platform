import { approvePayout } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { payoutDecisionBody } from '../../../_lib/schemas'

/**
 * POST /api/admin/payouts/{id}/decision (PAYMENTS §8): the second person approves or rejects a
 * payout above $5,000. Approving your own request is refused (four eyes).
 */
export const POST = route<{ id: string }>(
  'admin',
  async (ctx) => {
    const { id } = parseParams(ctx.params, idParam)
    const { decision } = await parseJson(ctx.req, payoutDecisionBody)
    return moneyAction(
      ctx,
      `payout-decision:${id}`,
      { decision },
      () => approvePayout(ctx.auditContext, id, decision),
      200,
    )
  },
  { permission: 'payouts.approve', audit: 'service' },
)
