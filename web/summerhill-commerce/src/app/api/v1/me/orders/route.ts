import { listOrdersForUser } from '@/modules/ordering'
import { route } from '@/server/http'

import { orderSummary } from '../../_lib/orders'

/** GET /api/v1/me/orders (G2-13): the signed-in customer's own orders, newest first. */
export const GET = route('customer', async ({ user }) => ({
  orders: (await listOrdersForUser(String(user!.id))).map(orderSummary),
}))
