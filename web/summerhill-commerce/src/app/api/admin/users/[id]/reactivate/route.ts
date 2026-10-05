import { reactivateUser } from '@/modules/identity'
import { parseParams, route } from '@/server/http'

import { userParam } from '../../../_lib/schemas'

/** POST /api/admin/users/{id}/reactivate */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) => ({
    user: await reactivateUser(auditContext, parseParams(params, userParam).id),
  }),
  { permission: 'users.manage', audit: 'service' },
)
