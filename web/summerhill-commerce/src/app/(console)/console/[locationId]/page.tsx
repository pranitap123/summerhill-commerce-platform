import type { Metadata } from 'next'

import { roleAt } from '@/modules/fulfilment'
import { getLocationSettings } from '@/modules/scheduling'

import { ConsoleHeader } from '../_lib/ConsoleHeader'
import { NotStaff } from '../_lib/NotStaff'
import { requireStaffPage } from '../_lib/requireStaffPage'
import { Queue } from './Queue'

export const metadata: Metadata = { title: 'Orders' }
export const dynamic = 'force-dynamic'

/** The store's order queue (G4-06). The data is polled by the client every 10 seconds. */
export default async function QueuePage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const id = Number(locationId)
  const scope = await requireStaffPage(`/console/${locationId}`)
  if (!scope) return <NotStaff />
  const settings = Number.isInteger(id) && id > 0 ? await getLocationSettings(id) : null
  const role = settings ? roleAt(scope, settings) : null
  if (!settings || !role) return <NotStaff what="this store" />
  return (
    <>
      <ConsoleHeader title={settings.locationName} locationId={id} />
      <Queue locationId={id} timeZone={settings.timeZone} />
    </>
  )
}
