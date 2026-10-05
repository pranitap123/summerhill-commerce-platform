import type { Metadata } from 'next'
import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'

import { OrderList } from '@/components/OrderList'
import { getSessionUser } from '@/modules/identity'
import { listOrdersForUser } from '@/modules/ordering'
import { mergeOpenGraph } from '@/utilities/mergeOpenGraph'

export const dynamic = 'force-dynamic'

export default async function Orders() {
  const user = await getSessionUser(await getHeaders()).catch(() => null)
  if (!user) {
    redirect(`/login?warning=${encodeURIComponent('Please login to access your orders.')}`)
  }

  const orders = await listOrdersForUser(String(user.id))

  return (
    <div className="border p-8 rounded-lg bg-primary-foreground w-full">
      <h1 className="text-3xl font-medium mb-8">Orders</h1>
      {orders.length === 0 ? <p>You have no orders.</p> : <OrderList orders={orders} />}
    </div>
  )
}

export const metadata: Metadata = {
  description: 'Your orders.',
  openGraph: mergeOpenGraph({
    title: 'Orders',
    url: '/orders',
  }),
  title: 'Orders',
}
