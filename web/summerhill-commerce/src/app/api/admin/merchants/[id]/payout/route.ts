import { requestPayout } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { payoutBody } from '../../../_lib/schemas'

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
