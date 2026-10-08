import { listOrdersForUser } from '@/modules/ordering'
import { route } from '@/server/http'

import { orderSummary } from '../../_lib/orders'

export const GET = route('customer', async ({ user }) => ({
  orders: (await listOrdersForUser(String(user!.id))).map(orderSummary),
}))
