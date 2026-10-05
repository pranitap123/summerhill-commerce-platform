import { startOnboarding } from '@/modules/payouts'
import { idParam, parseParams, route } from '@/server/http'

/**
 * POST /api/admin/merchants/{id}/onboarding-link (G5-02, ADR-0011): creates the Express account on
 * first use and returns a Stripe-hosted onboarding link (the simulator's page when simulated).
 */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params, auditContext }) =>
    startOnboarding(auditContext, parseParams(params, idParam).id),
  { permission: 'merchants.manage', audit: 'service' },
)
