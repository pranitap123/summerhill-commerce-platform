import { listDisputes } from '@/modules/payments'
import { parseQuery, route } from '@/server/http'

import { disputeListQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => {
    const { open } = parseQuery(req, disputeListQuery)
    return { disputes: await listDisputes({ open: open === 'true' }) }
  },
  { permission: 'disputes.manage' },
)
