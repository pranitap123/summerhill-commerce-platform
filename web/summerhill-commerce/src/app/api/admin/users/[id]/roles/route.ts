import { changeRoles } from '@/modules/identity'
import { parseJson, parseParams, route } from '@/server/http'

import { rolesBody, userParam } from '../../../_lib/schemas'

export const PUT = route<{ id: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id } = parseParams(params, userParam)
    const { roles } = await parseJson(req, rolesBody)
    return { user: await changeRoles(auditContext, id, roles) }
  },
  { permission: 'users.manage', audit: 'service' },
)
