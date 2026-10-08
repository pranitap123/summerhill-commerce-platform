import { listAlerts } from '@/modules/ops'
import { parseQuery, route } from '@/server/http'

import { alertQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => ({
    alerts: await listAlerts({ open: parseQuery(req, alertQuery).open === 'true' }),
  }),
  { permission: 'ops.enter' },
)
