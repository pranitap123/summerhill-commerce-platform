import { exportPersonalData } from '@/modules/privacy'
import { parseJson, route } from '@/server/http'

import { privacySubjectBody } from '../../_lib/schemas'

export const POST = route(
  'admin',
  async ({ req, auditContext }) =>
    exportPersonalData(auditContext, await parseJson(req, privacySubjectBody)),
  { permission: 'privacy.manage', audit: 'service' },
)
