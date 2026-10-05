import { listAlerts } from '@/modules/ops'
import { parseQuery, route } from '@/server/http'

import { alertQuery } from '../_lib/schemas'

/** GET /api/admin/alerts?open=true: operational alerts (auth expiry, disputes, recon, payouts…). */
export const GET = route(
  'admin',
  async ({ req }) => ({
    alerts: await listAlerts({ open: parseQuery(req, alertQuery).open === 'true' }),
  }),
  { permission: 'ops.enter' },
)
