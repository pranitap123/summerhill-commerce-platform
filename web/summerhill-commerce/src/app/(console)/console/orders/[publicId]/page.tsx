import type { Metadata } from 'next'

import { consoleOrder } from '@/modules/fulfilment'
import { getOrderByPublicId } from '@/modules/ordering'
import { getLocationSettings } from '@/modules/scheduling'

import { ConsoleHeader } from '../../_lib/ConsoleHeader'
import { NotStaff } from '../../_lib/NotStaff'
import { requireStaffPage } from '../../_lib/requireStaffPage'
import { PickScreen } from './PickScreen'

export const metadata: Metadata = { title: 'Order' }
export const dynamic = 'force-dynamic'

export default async function ConsoleOrderPage({
  params,
}: {
  params: Promise<{ publicId: string }>
}) {
  const { publicId } = await params
  const scope = await requireStaffPage(`/console/orders/${publicId}`)
  if (!scope) return <NotStaff />

  const initial = await consoleOrder(scope, publicId).catch(() => null)
  const order = initial ? await getOrderByPublicId(publicId) : null
  const settings = order ? await getLocationSettings(order.locationId) : null
  if (!initial || !order || !settings) return <NotStaff what="this order" />
  return (
    <>
      <ConsoleHeader
        title={`Order ${publicId}`}
        locationId={order.locationId}
        back={{ href: `/console/${order.locationId}`, label: 'Queue' }}
      />
      <PickScreen
        initial={JSON.parse(JSON.stringify(initial))}
        locationId={order.locationId}
        timeZone={settings.timeZone}
        me={String(scope.user.id)}
      />
    </>
  )
}
