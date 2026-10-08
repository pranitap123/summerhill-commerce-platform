import { computeMetrics, METRIC_DEFINITIONS } from '@/modules/reporting'
import { businessDayBounds } from '@/modules/payouts'
import { parseQuery, route } from '@/server/http'

import { metricsQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => {
    const q = parseQuery(req, metricsQuery)
    const today = new Date().toISOString().slice(0, 10)
    const to = q.to ?? today
    const from = q.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
    const period = { from: businessDayBounds(from).from, to: businessDayBounds(to).to }
    return { from, to, metrics: await computeMetrics(period), definitions: METRIC_DEFINITIONS }
  },
  { permission: 'metrics.read' },
)
