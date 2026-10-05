import { listDisputes } from '@/modules/payments'
import { parseQuery, route } from '@/server/http'

import { disputeListQuery } from '../_lib/schemas'

/** GET /api/admin/disputes?open=true (G5-06, A8): soonest evidence deadline first. */
export const GET = route(
  'admin',
  async ({ req }) => {
    const { open } = parseQuery(req, disputeListQuery)
    return { disputes: await listDisputes({ open: open === 'true' }) }
  },
  { permission: 'disputes.manage' },
)
