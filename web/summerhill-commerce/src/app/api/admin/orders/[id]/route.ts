import { orderDossier } from '@/modules/reporting'
import { HttpError, idParam, parseParams, route } from '@/server/http'

/**
 * GET /api/admin/orders/{id} (G5-03, A5): everything about one order: lines, payment, refunds,
 * disputes, issues, ledger, and one merged timeline (state changes, staff actions, emails, Stripe
 * webhooks, journals, audit entries).
 */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => {
    const { id } = parseParams(params, idParam)
    const dossier = await orderDossier(id)
    if (!dossier) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
    return dossier
  },
  { permission: 'orders.read' },
)
