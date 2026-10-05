import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { SUPPORT_REFUND_LIMIT_CENTS } from '@/modules/identity'
import { VOIDABLE_STATUSES } from '@/modules/ordering'
import { orderDossier } from '@/modules/reporting'

import { A, Badge, cad, Dl, PageTitle, Section, Table, when } from '../../_components/ui'
import { NotAuthorised } from '../../NotAuthorised'
import { requireOpsPage } from '../../requireAdminPage'
import { CancelForm, RefundForm } from './OrderActions'

export const metadata: Metadata = { title: 'Order' }
export const dynamic = 'force-dynamic'

/**
 * One order, fully explained (G5-03, A5): what was ordered and picked, the money (payment,
 * refunds, disputes, ledger), support issues, and one timeline of everything that happened.
 */
export default async function OrderPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ops = await requireOpsPage(`/ops/orders/${publicId}`, 'orders.read')
  if (!ops) return <NotAuthorised />
  if (!/^SH-[0-9A-Z]{6}$/.test(publicId)) notFound()
  const d = await orderDossier(publicId)
  if (!d) notFound()
  const { order, payment } = d
  const charged = payment?.status === 'captured'
  const cancellable =
    order.status === 'pending_payment' ||
    VOIDABLE_STATUSES.includes(order.status) ||
    (order.status === 'ready' && charged)
  return (
    <div>
      <PageTitle
        sub={`${d.merchant?.name ?? ''} · ${order.email}${order.pickupName ? ` · pickup: ${order.pickupName}` : ''}`}
      >
        <span className="font-mono">{order.publicId}</span> <Badge value={order.status} />
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Money">
          <Dl
            items={[
              [
                'Estimate / hold',
                `${cad(order.estimatedTotalCents)} / ${cad(order.authorizationCents)}`,
              ],
              ['Final total', cad(order.finalTotalCents)],
              ['Payment', payment ? <Badge key="p" value={payment.status} /> : '–'],
              ['Captured', cad(payment?.amountCapturedCents)],
              ['Platform fee', cad(payment?.applicationFeeCents)],
              ['Stripe fee', cad(payment?.processingFeeCents)],
              ['Refunded', `${cad(d.refundable.refundedCents)} (${order.refundStatus})`],
              [
                'PaymentIntent',
                <span key="pi" className="font-mono text-xs">
                  {payment?.paymentIntentId ?? '–'}
                </span>,
              ],
              [
                'Pickup',
                `${when(order.pickupStartsAt)}${order.collectedAt ? ` · collected ${when(order.collectedAt)} by ${order.handedOverBy}` : ''}`,
              ],
            ]}
          />
        </Section>
        <Section title="Ledger (per account)">
          <Table
            head={['Account', 'Debit', 'Credit']}
            empty="No journals yet."
            rows={d.ledger.map((l) => [l.account, cad(l.debitCents), cad(l.creditCents)])}
          />
        </Section>
      </div>

      <Section title="Lines">
        <Table
          head={['#', 'Item', 'Ordered', 'Picked', 'Status', 'Final', 'HST', 'Deposit']}
          rows={d.lines.map((l) => [
            l.lineNo,
            `${l.name}${l.substitutesLineId ? ' (substitute)' : ''}`,
            l.isWeighed ? `${((l.estimatedWeightMlb ?? 0) / 1000).toFixed(3)} lb` : l.quantity,
            l.isWeighed
              ? l.actualWeightMlb === null
                ? '–'
                : `${(l.actualWeightMlb / 1000).toFixed(3)} lb`
              : (l.pickedQuantity ?? '–'),
            <Badge key="s" value={l.status} />,
            cad(l.finalLineTotalCents),
            cad(l.finalTaxCents),
            cad(l.finalDepositCents),
          ])}
        />
      </Section>

      {ops.can('refunds.create') && charged && d.refundable.remainingCents > 0 && (
        <Section title="Refund">
          <RefundForm
            orderId={order.id}
            remainingCents={d.refundable.remainingCents}
            limitCents={ops.can('refunds.unlimited') ? null : SUPPORT_REFUND_LIMIT_CENTS}
            lines={d.refundable.lines.map((l) => {
              const line = d.lines.find((x) => x.id === l.lineId)!
              return {
                ...l,
                quantity: line.isWeighed ? null : (line.pickedQuantity ?? line.quantity),
                weighed: line.isWeighed,
              }
            })}
          />
        </Section>
      )}

      {ops.can('orders.cancel') && cancellable && (
        <Section title="Cancel on the customer's behalf">
          <CancelForm orderId={order.id} charged={charged} />
        </Section>
      )}

      {(d.refunds.length > 0 || d.disputes.length > 0 || d.issues.length > 0) && (
        <Section title="Refunds, disputes and issues">
          <Table
            head={['What', 'Amount', 'Status', 'Detail', 'When']}
            rows={[
              ...d.refunds.map((r) => [
                `Refund #${r.id} (${r.scenario.replace('_', ' ')})`,
                cad(r.amountCents),
                <Badge key="s" value={r.status} />,
                `${r.liability}: merchant ${cad(r.merchantCents)}, platform ${cad(r.platformCents)}, fee returned ${cad(r.feeRefundCents)} · ${r.reason} · by ${r.createdBy}`,
                when(r.createdAt),
              ]),
              ...d.disputes.map((x) => [
                <A key="d" href={`/ops/disputes/${x.id}`}>{`Dispute (${x.reason})`}</A>,
                cad(x.amountCents),
                <Badge key="s" value={x.status} />,
                `evidence due ${when(x.evidenceDueBy)}`,
                when(x.createdAt),
              ]),
              ...d.issues.map((i) => [
                <A key="i" href={`/ops/issues/${i.id}`}>{`Issue #${i.id} (${i.type})`}</A>,
                cad(i.claimedCents),
                <Badge key="s" value={i.status} />,
                i.description ?? '',
                when(i.createdAt),
              ]),
            ]}
          />
        </Section>
      )}

      <Section title={`Timeline (${d.timeline.length})`}>
        <ol className="space-y-1 text-sm">
          {d.timeline.map((t, i) => (
            <li key={i} className="grid grid-cols-[11rem_6rem_1fr] gap-2">
              <time className="text-neutral-600">{when(t.at)}</time>
              <span className="text-xs uppercase tracking-wide text-neutral-500">{t.source}</span>
              <span>
                {t.title}
                {t.actor && <span className="text-neutral-500"> · {t.actor}</span>}
                {t.detail && (
                  <details className="text-xs text-neutral-600">
                    <summary>details</summary>
                    <pre className="whitespace-pre-wrap">{JSON.stringify(t.detail, null, 2)}</pre>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
