import { setPayoutSchedule } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { payoutScheduleBody } from '../../../_lib/schemas'

export const POST = route<{ id: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const { interval } = await parseJson(req, payoutScheduleBody)
    await setPayoutSchedule(auditContext, id, interval)
    return { success: true, interval }
  },
  { permission: 'payouts.manage', audit: 'service' },
)
