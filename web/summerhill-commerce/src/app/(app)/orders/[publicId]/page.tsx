import type { Metadata } from 'next'
import { headers as getHeaders } from 'next/headers'
import Link from 'next/link'

import { orderView, type OrderView } from '@/app/api/v1/_lib/orders'
import { formatPickupWindow } from '@/components/storefront/pickupTime'
import { getSessionUser } from '@/modules/identity'
import { canViewOrder, getOrderByPublicId } from '@/modules/ordering'
import { formatCad, formatLb } from '@/utilities/money'

import {
  BuyAgain,
  CancelOrder,
  CheckIn,
  LiveRefresh,
  RateOrder,
  ReportProblem,
  SubstitutionDecision,
} from './actions'
import { CartReset, WaitForPayment } from './client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your order', robots: { index: false } }

const STORE_TZ = 'America/Toronto'

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>
  searchParams: Promise<{ t?: string; from?: string }>
}) {
  const { publicId } = await params
  const { t, from } = await searchParams
  const order = /^SH-[0-9A-Z]{6}$/.test(publicId) ? await getOrderByPublicId(publicId) : null
  const user = await getSessionUser(await getHeaders()).catch(() => null)
  if (!order || !canViewOrder(order, user, t))
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-2xl font-semibold">Order not found</h1>
        <p>
          Check the link in your confirmation email, or{' '}
          <Link href="/find-order">request a new link</Link>.
        </p>
      </div>
    )

  const view = await orderView(order)
  const token = t ?? null
  const waiting = view.status === 'pending_payment'
  const inStore = ['placed', 'accepted', 'picking', 'picked'].includes(view.status)
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {from === 'checkout' && <CartReset />}
      <LiveRefresh active={inStore} />
      <p className="text-sm text-neutral-600">Order {view.publicId}</p>
      <h1 className="mb-2 text-3xl font-semibold text-[#1F3A2E]">{view.statusLabel}</h1>
      {waiting && <WaitForPayment />}
      <StatusMessage view={view} />

      {view.pickup.startsAt && view.pickup.endsAt && view.status !== 'cancelled' && (
        <section className="mb-8 rounded-xl bg-white p-6 shadow-sm" aria-labelledby="pickup">
          <h2 id="pickup" className="mb-2 font-semibold">
            Pickup
          </h2>
          <p>{formatPickupWindow(view.pickup.startsAt, view.pickup.endsAt, STORE_TZ)}</p>
          {view.pickupName && <p className="text-sm">Collected by {view.pickupName}</p>}
          {view.pickup.code && (
            <p className="mt-3">
              Pickup code{' '}
              <strong className="font-mono text-2xl tracking-widest">{view.pickup.code}</strong>
              <span className="block text-sm text-neutral-600">
                Tell this code to the store staff when you collect. Don&apos;t share it otherwise.
              </span>
            </p>
          )}
          {view.pickup.arrivedAt && view.status !== 'collected' && (
            <p className="mt-3 rounded bg-[#EEF3EC] p-2 text-sm" role="status">
              The store knows you&apos;re here.
            </p>
          )}
          {view.actions.checkIn && <CheckIn publicId={view.publicId} token={token} />}
          {view.actions.cancel && <CancelOrder publicId={view.publicId} token={token} />}
        </section>
      )}

      <section className="mb-8 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-semibold">Items</h2>
        <ul className="divide-y divide-[#DCE5D8]">
          {view.lines.map((l) => (
            <li key={l.lineNo} className="flex justify-between gap-4 py-2 text-sm">
              <span>
                {l.replaces && <span className="block text-xs text-neutral-600">Replacement</span>}
                <span className={l.status === 'substituted' ? 'line-through' : undefined}>
                  {l.name}
                </span>{' '}
                <span className="text-neutral-600">
                  {l.unit === 'lb'
                    ? l.actualWeightLb !== null
                      ? formatLb(l.actualWeightLb)
                      : `est. ${formatLb(l.estimatedWeightLb)}`
                    : `× ${l.quantity}`}
                  {l.taxable && ' · HST'}
                  {l.status === 'unavailable' && !l.replaces && ' · unavailable, not charged'}
                  {l.status === 'substituted' && ' · replaced'}
                </span>
                {l.replaces && (
                  <span className="block text-xs text-neutral-700">
                    Instead of {l.replaces.name}. You never pay more than the original.
                  </span>
                )}
                {l.replaces && view.actions.decideSubstitutions && (
                  <SubstitutionDecision
                    publicId={view.publicId}
                    token={token}
                    lineId={l.lineId}
                    decision={l.customerDecision}
                  />
                )}
              </span>
              <span className="whitespace-nowrap">
                {l.status === 'substituted' || (l.status === 'unavailable' && !l.replaces)
                  ? formatCad(0)
                  : formatCad(l.finalLineTotalCents ?? l.lineTotalCents)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t pt-4 text-sm">
          {view.final ? (
            <>
              <Row label="Items" cents={view.final.itemSubtotalCents} />
              {!!view.final.depositCents && (
                <Row label="Deposits" cents={view.final.depositCents} />
              )}
              <Row label="HST" cents={view.final.taxCents} />
              <Row label="Charged" cents={view.final.totalCents} strong />
            </>
          ) : (
            <>
              <Row label="Items" cents={view.estimate.itemSubtotalCents} />
              {!!view.estimate.depositCents && (
                <Row label="Deposits" cents={view.estimate.depositCents} />
              )}
              <Row label="HST" cents={view.estimate.taxCents} />
              <Row label="Estimated total" cents={view.estimate.totalCents} strong />
            </>
          )}
        </dl>
        {view.final ? (
          <p className="pt-2 text-sm text-neutral-700">
            Your card was held for {formatCad(view.estimate.authorizationCents)};{' '}
            {formatCad(view.final.releasedCents)} of the hold was released.
          </p>
        ) : (
          view.estimate.weightBufferCents > 0 && (
            <p className="pt-2 text-sm text-neutral-700">
              Card hold {formatCad(view.estimate.authorizationCents)} includes{' '}
              {formatCad(view.estimate.weightBufferCents)} for weighed items. You&apos;re charged
              only the final amount after packing.
            </p>
          )
        )}
      </section>

      {(view.refunds.length > 0 || view.issues.length > 0) && (
        <section className="mb-8 rounded-xl bg-white p-6 shadow-sm text-sm">
          <h2 className="mb-2 font-semibold">Refunds and reported problems</h2>
          <ul className="space-y-1">
            {view.refunds.map((r, i) => (
              <li key={`r${i}`}>
                Refunded {formatCad(r.amountCents)}
                {r.at &&
                  ` on ${new Date(r.at).toLocaleDateString('en-CA', { timeZone: STORE_TZ })}`}
              </li>
            ))}
            {view.issues.map((iss, i) => (
              <li key={`i${i}`}>
                Problem reported ({iss.type.replace('_', ' ')}):{' '}
                {iss.status === 'open'
                  ? 'our support team is looking at it'
                  : iss.status === 'rejected'
                    ? `reviewed, not refunded${iss.note ? `: ${iss.note}` : ''}`
                    : 'refunded'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.actions.reportIssue && (
        <section className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <ReportProblem
            publicId={view.publicId}
            token={token}
            lines={view.lines
              .filter((l) => (l.finalLineTotalCents ?? 0) > 0)
              .map((l) => ({
                lineId: l.lineId,
                name: l.name,
                quantity: l.quantity,
                weighed: l.pricingModel === 'per_weight',
              }))}
          />
        </section>
      )}

      {view.actions.rate && (
        <section className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <RateOrder publicId={view.publicId} token={token} current={view.rating} />
        </section>
      )}

      {view.actions.reorder && (
        <section className="mb-8">
          <BuyAgain publicId={view.publicId} token={token} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ol className="space-y-1 text-sm">
          {view.timeline.map((e, i) => (
            <li key={i}>
              <time dateTime={new Date(e.at).toISOString()} className="text-neutral-600">
                {new Date(e.at).toLocaleString('en-CA', { timeZone: STORE_TZ })}
              </time>{' '}
              · {e.label}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function StatusMessage({ view }: { view: OrderView }) {
  const text: Partial<Record<OrderView['status'], string>> = {
    placed: `Thanks! Your card is authorised and the store will confirm your order shortly. A confirmation was sent to ${view.email}.`,
    accepted: 'The store has accepted your order and will start packing it soon.',
    picking:
      'Your order is being packed. If an item is unavailable we may replace it; you can accept or reject replacements here until packing is done.',
    picked: 'Packed. We are charging the final amount now.',
    ready: 'Your order is ready. Bring your pickup code.',
    collected: 'Thanks for shopping with us!',
    no_show:
      "Your order wasn't collected in time. Contact the store if you'd still like to pick it up.",
    cancelled: view.refunds.length
      ? 'This order was cancelled and refunded in full.'
      : 'This order was cancelled. The hold on your card was released: nothing was charged.',
  }
  if (view.status === 'abandoned')
    return (
      <p className="mb-6">
        This checkout wasn&apos;t completed, so nothing was charged. Your items are still in your{' '}
        <Link href="/cart">cart</Link>.
      </p>
    )
  return text[view.status] ? <p className="mb-6">{text[view.status]}</p> : null
}

function Row({ label, cents, strong }: { label: string; cents: number | null; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{formatCad(cents)}</dd>
    </div>
  )
}
