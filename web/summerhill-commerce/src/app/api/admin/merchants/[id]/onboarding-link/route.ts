import { startOnboarding } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) =>
    startOnboarding(auditContext, parseParams(params, idParam).id),
  { permission: 'merchants.manage', audit: 'service' },
)
