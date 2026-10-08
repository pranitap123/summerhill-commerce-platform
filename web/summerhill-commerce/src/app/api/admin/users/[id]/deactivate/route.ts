import { deactivateUser } from '@/modules/identity'
import { parseParams, route } from '@/server/http'

import { userParam } from '../../../_lib/schemas'

export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) => ({
    user: await deactivateUser(auditContext, parseParams(params, userParam).id),
  }),
  { permission: 'users.manage', audit: 'service' },
)
