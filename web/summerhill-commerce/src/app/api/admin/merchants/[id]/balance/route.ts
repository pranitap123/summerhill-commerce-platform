import { merchantBalance } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => merchantBalance(parseParams(params, idParam).id),
  { permission: 'payouts.manage' },
)
