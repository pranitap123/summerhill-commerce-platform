import { submitDisputeEvidence } from '@/modules/payments'
import { idParam, parseParams, route } from '@/server/http'

export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) =>
    submitDisputeEvidence(auditContext, parseParams(params, idParam).id),
  { permission: 'disputes.manage', audit: 'service' },
)
