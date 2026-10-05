import { submitDisputeEvidence } from '@/modules/payments'
import { idParam, parseParams, route } from '@/server/http'

/** POST /api/admin/disputes/{id}/submit: send the (freshly rebuilt) evidence to Stripe. */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) =>
    submitDisputeEvidence(auditContext, parseParams(params, idParam).id),
  { permission: 'disputes.manage', audit: 'service' },
)
