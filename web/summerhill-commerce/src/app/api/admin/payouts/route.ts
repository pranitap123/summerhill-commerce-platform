import { listPayouts } from '@/modules/payouts'
import { parseQuery, route } from '@/server/http'

import { payoutListQuery } from '../_lib/schemas'

/** GET /api/admin/payouts?merchantId=&status= (G5-07): manual and automatic payouts. */
export const GET = route(
  'admin',
  async ({ req }) => ({ payouts: await listPayouts(parseQuery(req, payoutListQuery)) }),
  { permission: 'payouts.manage' },
)
