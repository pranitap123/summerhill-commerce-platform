import { getMfaStatus, permissionsOf } from '@/modules/identity'
import { route } from '@/server/http'

export const GET = route(
  'admin',
  async ({ user }) => ({
    user: { id: String(user!.id), email: user!.email, roles: user!.roles },
    permissions: permissionsOf(user),
    mfa: await getMfaStatus(String(user!.id)),
  }),
  { permission: 'ops.enter' },
)
