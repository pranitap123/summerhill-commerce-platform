import { removeMembership, setMembership } from '@/modules/identity'
import { parseJson, parseParams, route } from '@/server/http'

import { membershipBody, membershipParam } from '../../../../_lib/schemas'

export const PUT = route<{ id: string; merchantId: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id, merchantId } = parseParams(params, membershipParam)
    const body = await parseJson(req, membershipBody)
    await setMembership(auditContext, id, { merchantId, ...body })
    return { ok: true }
  },
  { permission: 'users.manage', audit: 'service' },
)

export const DELETE = route<{ id: string; merchantId: string }>(
  'admin',
  async ({ params, auditContext }) => {
    const { id, merchantId } = parseParams(params, membershipParam)
    await removeMembership(auditContext, id, merchantId)
    return { ok: true }
  },
  { permission: 'users.manage', audit: 'service' },
)
