import { refreshAccountStatus } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

export const POST = route<{ id: string }>(
  'admin',
  async ({ params }) => ({ merchant: await refreshAccountStatus(parseParams(params, idParam).id) }),
  { permission: 'merchants.manage' },
)
