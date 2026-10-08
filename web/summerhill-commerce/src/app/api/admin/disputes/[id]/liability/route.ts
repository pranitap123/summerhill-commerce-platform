import { setDisputeLiability } from '@/modules/payments'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { disputeLiabilityBody } from '../../../_lib/schemas'

export const POST = route<{ id: string }>(
  'admin',
  async (ctx) => {
    const { id } = parseParams(ctx.params, idParam)
    const body = await parseJson(ctx.req, disputeLiabilityBody)
    return moneyAction(
      ctx,
      `dispute-liability:${id}`,
      body,
      () => setDisputeLiability(ctx.auditContext, id, body),
      200,
    )
  },
  { permission: 'disputes.manage', audit: 'service' },
)
