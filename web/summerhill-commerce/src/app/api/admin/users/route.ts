import { inviteUser, listTeam } from '@/modules/identity'
import { listMerchants } from '@/modules/merchant'
import { parseJson, route } from '@/server/http'

import { inviteBody } from '../_lib/schemas'

/** GET /api/admin/users (G5-15, A11): platform staff and store staff, with MFA and memberships. */
export const GET = route(
  'admin',
  async () => {
    const [team, merchants] = await Promise.all([listTeam(), listMerchants()])
    return { users: team, merchants: merchants.map((m) => ({ id: m.id, name: m.name })) }
  },
  { permission: 'users.manage' },
)

/** POST: invite by email (password-setup email; MFA at first sign-in). Audited. */
export const POST = route(
  'admin',
  async ({ req, auditContext }) => {
    const body = await parseJson(req, inviteBody)
    const user = await inviteUser(auditContext, {
      email: body.email,
      name: body.name ?? null,
      roles: body.roles,
      membership: body.membership,
    })
    return Response.json({ user }, { status: 201 })
  },
  { permission: 'users.manage', audit: 'service' },
)
