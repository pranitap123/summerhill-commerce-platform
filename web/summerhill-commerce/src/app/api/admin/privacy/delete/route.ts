import { deletePersonalData } from '@/modules/privacy'
import { parseJson, route } from '@/server/http'

import { privacyDeleteBody } from '../../_lib/schemas'

/**
 * POST /api/admin/privacy/delete (SECURITY §7.3): anonymise the account and the orders' contact
 * data; orders stay for the 7-year retention. `confirm: "DELETE"` is required.
 */
export const POST = route(
  'admin',
  async ({ req, auditContext }) => {
    const { email, userId } = await parseJson(req, privacyDeleteBody)
    return deletePersonalData(auditContext, { email, userId })
  },
  { permission: 'privacy.manage', audit: 'service' },
)
