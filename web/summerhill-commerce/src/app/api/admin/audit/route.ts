import { searchAuditLog } from '@/modules/ops'
import { parseQuery, route } from '@/server/http'

import { auditQuery } from '../_lib/schemas'

/** GET /api/admin/audit?actorId=&action=&targetType=&targetId=&before= (G5-09, A12). */
export const GET = route(
  'admin',
  async ({ req }) => ({ entries: await searchAuditLog(parseQuery(req, auditQuery)) }),
  { permission: 'audit.read' },
)
