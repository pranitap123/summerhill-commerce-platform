import type { Metadata } from 'next'

import { roleAt } from '@/modules/fulfilment'
import { getLocationSettings } from '@/modules/scheduling'

import { ConsoleHeader } from '../../_lib/ConsoleHeader'
import { NotStaff } from '../../_lib/NotStaff'
import { requireStaffPage } from '../../_lib/requireStaffPage'
import { Availability } from './Availability'

export const metadata: Metadata = { title: 'Out of stock today' }
export const dynamic = 'force-dynamic'

/** "Out of stock today" toggles for products and whole categories (G4-20). */
export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ locationId: string }>
}) {
  const { locationId } = await params
  const id = Number(locationId)
  const scope = await requireStaffPage(`/console/${locationId}/availability`)
  if (!scope) return <NotStaff />
  const settings = Number.isInteger(id) && id > 0 ? await getLocationSettings(id) : null
  if (!settings || !roleAt(scope, settings)) return <NotStaff what="this store" />
  return (
    <>
      <ConsoleHeader title={`${settings.locationName} · out of stock today`} locationId={id} />
      <Availability locationId={id} merchantId={settings.merchantId} timeZone={settings.timeZone} />
    </>
  )
}
