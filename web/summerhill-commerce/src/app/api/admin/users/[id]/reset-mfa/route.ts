import { resetUserMfa } from '@/modules/identity'
import { parseParams, route } from '@/server/http'

import { userParam } from '../../../_lib/schemas'

/** POST /api/admin/users/{id}/reset-mfa: lost authenticator; set up again at next sign-in. */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) => {
    await resetUserMfa(auditContext, parseParams(params, userParam).id)
    return { reset: true }
  },
  { permission: 'users.manage', audit: 'service' },
)
