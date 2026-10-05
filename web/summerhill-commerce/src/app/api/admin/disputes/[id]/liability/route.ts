import { setDisputeLiability } from '@/modules/payments'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction } from '../../../_lib/helpers'
import { disputeLiabilityBody } from '../../../_lib/schemas'

/**
 * POST /api/admin/disputes/{id}/liability (ORDERS §9): record who bears the chargeback; a
 * merchant-liable amount is recovered with a transfer reversal. Idempotency-Key required.
 */
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
