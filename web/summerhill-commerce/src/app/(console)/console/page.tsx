import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { accessibleLocations } from '@/modules/fulfilment'

import { ConsoleHeader } from './_lib/ConsoleHeader'
import { NotStaff } from './_lib/NotStaff'
import { requireStaffPage } from './_lib/requireStaffPage'

export const metadata: Metadata = { title: 'Stores' }
export const dynamic = 'force-dynamic'

/** /console: pick a store (straight to its queue when the caller works at only one). */
export default async function ConsoleHome() {
  const scope = await requireStaffPage('/console')
  if (!scope) return <NotStaff />
  const locations = await accessibleLocations(scope)
  if (locations.length === 1) redirect(`/console/${locations[0].locationId}`)
  return (
    <>
      <ConsoleHeader title="Store console" />
      <main className="mx-auto max-w-3xl p-6">
        <h2 className="mb-4 text-lg font-semibold">Choose a store</h2>
        {locations.length === 0 && <p>No stores yet.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => (
            <li key={l.locationId}>
              <Link
                href={`/console/${l.locationId}`}
                className="block rounded-xl bg-white p-4 shadow-sm hover:shadow"
              >
                <span className="block font-semibold">{l.locationName}</span>
                <span className="text-sm text-neutral-600">
                  {l.merchantName} · {l.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
