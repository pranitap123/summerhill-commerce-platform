import { refundsByAgent } from '@/modules/payments'
import { parseQuery, route } from '@/server/http'

import { refundReportQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => {
    const { days } = parseQuery(req, refundReportQuery)
    return { days, byAgent: await refundsByAgent(days) }
  },
  { permission: 'finance.read' },
)
