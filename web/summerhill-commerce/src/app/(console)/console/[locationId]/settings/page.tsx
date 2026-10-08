import type { Metadata } from 'next'

import { roleAt } from '@/modules/fulfilment'
import { getLocationSettings } from '@/modules/scheduling'

import { ConsoleHeader } from '../../_lib/ConsoleHeader'
import { NotStaff } from '../../_lib/NotStaff'
import { requireStaffPage } from '../../_lib/requireStaffPage'
import { SettingsForm } from './SettingsForm'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locationId: string }>
}) {
  const { locationId } = await params
  const id = Number(locationId)
  const scope = await requireStaffPage(`/console/${locationId}/settings`)
  if (!scope) return <NotStaff />
  const settings = Number.isInteger(id) && id > 0 ? await getLocationSettings(id) : null
  const role = settings ? roleAt(scope, settings) : null
  if (!settings || !role) return <NotStaff what="this store" />
  return (
    <>
      <ConsoleHeader title={`${settings.locationName} · settings`} locationId={id} />
      <SettingsForm locationId={id} canEdit={role === 'owner'} timeZone={settings.timeZone} />
    </>
  )
}
