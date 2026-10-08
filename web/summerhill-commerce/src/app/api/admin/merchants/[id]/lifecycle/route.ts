import { changeLifecycle } from '@/modules/merchant'
import { finishOffboarding } from '@/modules/payouts'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { lifecycleBody } from '../../../_lib/schemas'

export const POST = route<{ id: string }>(
  'admin',
  async ({ req, params, audit, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const { action, reason } = await parseJson(req, lifecycleBody)
    if (action === 'finish_offboarding') return finishOffboarding(auditContext, id)
    const { before, after } = await changeLifecycle(id, action, reason ?? null)
    await audit({
      action: `merchant.${action}`,
      targetType: 'merchant',
      targetId: id,
      data: {
        before: before.lifecycle_status,
        after: after.lifecycle_status,
        reason: reason ?? null,
      },
    })
    return { merchant: after }
  },
  { permission: 'merchants.manage' },
)
