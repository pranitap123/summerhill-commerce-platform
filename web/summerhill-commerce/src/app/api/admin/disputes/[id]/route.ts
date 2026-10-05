import { getDispute } from '@/modules/payments'
import { HttpError, idParam, parseParams, route } from '@/server/http'

/** GET /api/admin/disputes/{id}: the dispute with its evidence pack. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => {
    const dispute = await getDispute(parseParams(params, idParam).id)
    if (!dispute) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found')
    return dispute
  },
  { permission: 'disputes.manage' },
)
