import { merchantBalance } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

/** GET /api/admin/merchants/{id}/balance: the connected account's available and pending funds. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => merchantBalance(parseParams(params, idParam).id),
  { permission: 'payouts.manage' },
)
