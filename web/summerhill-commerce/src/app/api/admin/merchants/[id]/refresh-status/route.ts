import { refreshAccountStatus } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

/** POST /api/admin/merchants/{id}/refresh-status: read the Stripe account now (webhooks normally do). */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params }) => ({ merchant: await refreshAccountStatus(parseParams(params, idParam).id) }),
  { permission: 'merchants.manage' },
)
