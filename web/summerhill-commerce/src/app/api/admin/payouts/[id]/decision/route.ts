import { approvePayout } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { payoutDecisionBody } from '../../../_lib/schemas'

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
