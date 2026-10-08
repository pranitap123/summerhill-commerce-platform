import { orderDossier } from '@/modules/reporting'
import { HttpError, idParam, parseParams, route } from '@/server/http'

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
