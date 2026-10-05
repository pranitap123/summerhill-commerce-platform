import { searchOrders } from '@/modules/reporting'
import { parseQuery, route } from '@/server/http'

import { orderSearchQuery } from '../_lib/schemas'

/**
 * GET /api/admin/orders?q=&status=&merchantId=&from=&to=&hasIssue= (G5-03): order search by public
 * id, email or pickup name, newest first.
 */
export const GET = route(
  'admin',
  async ({ req }) => {
    const q = parseQuery(req, orderSearchQuery)
    const orders = await searchOrders({
      q: q.q,
      status: q.status,
      merchantId: q.merchantId,
      from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
      to: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined,
      hasIssue: q.hasIssue === 'true' ? true : undefined,
      limit: q.limit,
    })
    return { count: orders.length, orders }
  },
  { permission: 'orders.read' },
)
