import type { Metadata } from 'next'

import { Barcode } from '@/components/console/Barcode'
import { formatPickupWindow } from '@/components/storefront/pickupTime'
import { consoleOrder, encodeScaleLabel } from '@/modules/fulfilment'
import { getOrderByPublicId } from '@/modules/ordering'
import { getLocationSettings } from '@/modules/scheduling'

import { NotStaff } from '../../../_lib/NotStaff'
import { requireStaffPage } from '../../../_lib/requireStaffPage'
import { PrintButton } from './PrintButton'

export const metadata: Metadata = { title: 'Pick slip' }
export const dynamic = 'force-dynamic'

const money = (cents: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>
  searchParams: Promise<{ bags?: string }>
}) {
  const { publicId } = await params
  const bags = Math.min(20, Math.max(1, Number((await searchParams).bags) || 2))
  const scope = await requireStaffPage(`/console/orders/${publicId}/print`)
  if (!scope) return <NotStaff />
  const order = await consoleOrder(scope, publicId).catch(() => null)
  const row = order ? await getOrderByPublicId(publicId) : null
  const settings = row ? await getLocationSettings(row.locationId) : null
  if (!order || !settings) return <NotStaff what="this order" />
  const window =
    order.pickupStartsAt && order.pickupEndsAt
      ? formatPickupWindow(order.pickupStartsAt, order.pickupEndsAt, settings.timeZone)
      : ''
  const byCategory = new Map<string, typeof order.lines>()
  for (const l of order.lines)
    byCategory.set(l.category ?? 'Other', [...(byCategory.get(l.category ?? 'Other') ?? []), l])
  const cold = order.cold

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p>
          Bag labels:{' '}
          {[1, 2, 3, 4, 6].map((n) => (
            <a
              key={n}
              href={`?bags=${n}`}
              className={`mx-1 underline ${n === bags ? 'font-bold' : ''}`}
            >
              {n}
            </a>
          ))}
        </p>
        <PrintButton />
      </div>

      <section aria-label="Pick slip" className="break-after-page">
        <h1 className="text-2xl font-bold">
          Pick slip · <span className="font-mono">{order.publicId}</span>
        </h1>
        <p>
          {order.pickupName} · {window} · {settings.locationName}
          {cold && ' · ❄ COLD ITEMS: keep in the fridge'}
        </p>
        {[...byCategory.entries()].map(([category, lines]) => (
          <div key={category} className="mt-4">
            <h2 className="border-b border-black font-semibold">{category}</h2>
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-neutral-300 align-top">
                    <td className="w-6 py-2">☐</td>
                    <td className="py-2">
                      <strong>{l.name}</strong>
                      <br />
                      {l.sellBy === 'weight'
                        ? `${l.estimatedWeightLb?.toFixed(2)} lb`
                        : `× ${l.quantity}${l.isWeighed ? ` (≈ ${l.estimatedWeightLb?.toFixed(2)} lb)` : ''}`}
                      {l.note && <em> · Note: {l.note}</em>}
                      <br />
                      <span className="text-xs">
                        If unavailable:{' '}
                        {l.replacementPreference === 'refund'
                          ? 'refund'
                          : l.replacementPreference === 'specific'
                            ? l.replacementProducts.map((p, i) => `${i + 1}. ${p.name}`).join('; ')
                            : 'best match'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {l.upc && <Barcode code={l.upc} height={32} />}
                      {l.upc && l.isWeighed && l.upc.startsWith('2') && (
                        <div className="text-xs">
                          Demo scale label ({money(l.lineTotalCents)})
                          <Barcode
                            code={encodeScaleLabel(l.upc, Math.min(99_999, l.lineTotalCents))}
                            height={32}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section aria-label="Bag labels" className="mt-8 grid grid-cols-2 gap-4 print:mt-0">
        {Array.from({ length: bags }, (_, i) => (
          <div key={i} className="break-inside-avoid rounded border-2 border-black p-4">
            <p className="font-mono text-3xl font-bold">{order.publicId}</p>
            <p className="text-xl">{order.pickupName}</p>
            <p>{window}</p>
            <p className="mt-2 font-semibold">
              Bag {i + 1} of {bags}
              {cold && ' · ❄ COLD'}
            </p>
          </div>
        ))}
      </section>
    </main>
  )
}
