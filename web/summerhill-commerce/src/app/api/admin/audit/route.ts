import { searchAuditLog } from '@/modules/ops'
import { parseQuery, route } from '@/server/http'

import { auditQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => ({ entries: await searchAuditLog(parseQuery(req, auditQuery)) }),
  { permission: 'audit.read' },
)
