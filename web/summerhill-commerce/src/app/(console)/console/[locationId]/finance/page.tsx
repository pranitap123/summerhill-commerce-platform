import type { Metadata } from 'next'

import { requireMerchantOwner, roleAt } from '@/modules/fulfilment'
import { getLocation, getMerchantById } from '@/modules/merchant'
import { listPayouts, merchantStatement, statementMonths } from '@/modules/payouts'

import { ConsoleHeader } from '../../_lib/ConsoleHeader'
import { NotStaff } from '../../_lib/NotStaff'
import { requireStaffPage } from '../../_lib/requireStaffPage'

export const metadata: Metadata = { title: 'Sales and payouts' }
export const dynamic = 'force-dynamic'

const cad = (c: number | null | undefined) =>
  c === null || c === undefined
    ? '–'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(c / 100)

/**
 * Sales, fees, refunds, payouts and statements for the store owner (G5-13, M12). The figures come
 * from the same ledger as the platform's statements.
 */
export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { locationId } = await params
  const id = Number(locationId)
  const scope = await requireStaffPage(`/console/${locationId}/finance`)
  if (!scope) return <NotStaff />
  const location = Number.isInteger(id) && id > 0 ? await getLocation(id) : null
  if (!location || !roleAt(scope, { merchantId: location.merchant_id, locationId: id }))
    return <NotStaff what="this store" />
  try {
    requireMerchantOwner(scope, location.merchant_id)
  } catch {
    return <NotStaff what="the store's finances (owners only)" />
  }
  const merchant = (await getMerchantById(location.merchant_id))!
  const months = await statementMonths(merchant.id)
  const { month: asked } = await searchParams
  const month =
    asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked)
      ? asked
      : (months[0] ?? new Date().toISOString().slice(0, 7))
  const [s, payouts] = await Promise.all([
    merchantStatement(merchant.id, month),
    listPayouts({ merchantId: merchant.id, limit: 20 }),
  ])
  const rows: Array<[string, number, string?]> = [
    ['Sales (charged to customers)', s.salesCents],
    ['Platform commission', -s.commissionCents],
    ['HST on commission', -s.hstOnCommissionCents],
    [
      'Refunds you bore',
      -s.merchantRefundCents,
      'missing, damaged or wrong items (liability matrix)',
    ],
    ['Commission returned on those refunds', s.commissionReturnedCents],
    ['Chargebacks recovered from you', -s.disputeRecoveryCents],
  ]
  return (
    <>
      <ConsoleHeader title={`${merchant.name} · sales and payouts`} locationId={id} />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <form className="flex items-end gap-3 text-sm">
          <label>
            <span className="block">Month</span>
            <select name="month" defaultValue={month} className="rounded border px-2 py-1">
              {(months.length ? months : [month]).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className="rounded bg-[#1F3A2E] px-3 py-1.5 text-white">Show</button>
          <a
            className="underline"
            href={`/api/console/merchants/${merchant.id}/statements/${month}`}
          >
            Download statement (CSV)
          </a>
        </form>
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">
            {month}: {s.orders} order(s)
          </h2>
          <dl className="space-y-1 text-sm">
            {rows.map(([label, cents, note]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt>
                  {label}
                  {note && <span className="block text-xs text-neutral-600">{note}</span>}
                </dt>
                <dd>{cad(cents)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Net transferred to your Stripe balance</dt>
              <dd>{cad(s.netTransferCents)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-neutral-700">
              <dt>Refunds the platform bore (not deducted)</dt>
              <dd>{cad(s.platformRefundCents)}</dd>
            </div>
          </dl>
        </section>
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">
            Payouts to your bank (schedule: {merchant.payout_schedule_interval})
          </h2>
          {payouts.length === 0 ? (
            <p className="text-sm">No payouts yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {payouts.map((p) => (
                <li key={p.id} className="flex justify-between py-2">
                  <span>
                    {cad(p.amountCents)} · {p.method}
                    {p.failureMessage && (
                      <span className="block text-[#B3261E]">Failed: {p.failureMessage}</span>
                    )}
                  </span>
                  <span>
                    {p.status.replace('_', ' ')}
                    {p.arrivalDate && `, arrives ${p.arrivalDate}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
