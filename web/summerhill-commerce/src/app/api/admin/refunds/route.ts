import { refundsByAgent } from '@/modules/payments'
import { parseQuery, route } from '@/server/http'

import { refundReportQuery } from '../_lib/schemas'

/** GET /api/admin/refunds?days=7: refunds by agent (threat T16's weekly review). */
export const GET = route(
  'admin',
  async ({ req }) => {
    const { days } = parseQuery(req, refundReportQuery)
    return { days, byAgent: await refundsByAgent(days) }
  },
  { permission: 'finance.read' },
)
