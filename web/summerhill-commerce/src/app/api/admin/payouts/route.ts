import { listPayouts } from '@/modules/payouts'
import { parseQuery, route } from '@/server/http'

import { payoutListQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => ({ payouts: await listPayouts(parseQuery(req, payoutListQuery)) }),
  { permission: 'payouts.manage' },
)
