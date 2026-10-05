import { getMerchantById, merchantHealth } from '@/modules/merchant'
import { listPayouts } from '@/modules/payouts'
import { HttpError, idParam, parseParams, route } from '@/server/http'

/** GET /api/admin/merchants/{id} (A2): the merchant, its health and recent payouts. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => {
    const { id } = parseParams(params, idParam)
    const merchant = await getMerchantById(id)
    if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
    const [health, payouts] = await Promise.all([
      merchantHealth(merchant),
      listPayouts({ merchantId: id, limit: 10 }),
    ])
    return { merchant, health, payouts }
  },
  { permission: 'merchants.read' },
)
