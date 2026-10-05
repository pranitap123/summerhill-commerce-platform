import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { orderDossier } from '@/modules/reporting'
import { issueContext } from '@/modules/support'

import { A, Badge, cad, Dl, PageTitle, Section, Table, when } from '../../_components/ui'
import { NotAuthorised } from '../../NotAuthorised'
import { requireOpsPage } from '../../requireAdminPage'
import { ResolveIssue } from './ResolveIssue'

export const metadata: Metadata = { title: 'Support issue' }
export const dynamic = 'force-dynamic'

/**
 * Agent view (ORDERS §10): the report, the pick records (weights, substitutions, picker), what
 * the customer was told, their earlier issues and 90-day refunds.
 */
export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ops = await requireOpsPage(`/ops/issues/${raw}`, 'issues.resolve')
  if (!ops) return <NotAuthorised />
  const id = Number(raw)
  const ctx = Number.isInteger(id) && id > 0 ? await issueContext(id).catch(() => null) : null
  if (!ctx) notFound()
  const { issue } = ctx
  const order = (await orderDossier(issue.orderId))!
  const decision = issue.decision as { decision?: string; reasons?: string[] }
  return (
    <div>
      <PageTitle sub={`Order ${issue.publicId} · reported ${when(issue.createdAt)}`}>
        Issue #{issue.id} <Badge value={issue.status} />
      </PageTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Report">
          <Dl
            items={[
              [
                'Order',
                <A key="o" href={`/ops/orders/${issue.publicId}`}>
                  {issue.publicId}
                </A>,
              ],
              ['Type', issue.type.replace('_', ' ')],
              [
                'Items',
                issue.lines
                  .map(
                    (l) =>
                      `${l.name ?? l.lineId}${l.quantity ? ` × ${l.quantity}` : ''} (${cad(l.amountCents)})`,
                  )
                  .join(', ') || '–',
              ],
              ['Claimed', cad(issue.claimedCents)],
              ['Customer says', issue.description ?? '–'],
              ['Policy', `${decision.decision ?? '–'}: ${(decision.reasons ?? []).join('; ')}`],
              ['Customer refunds (90 days)', cad(ctx.customer90DayRefundCents)],
              [
                'Resolution',
                issue.resolvedAt
                  ? `${issue.resolutionNote ?? ''} (by ${issue.resolvedBy}, ${when(issue.resolvedAt)})`
                  : '–',
              ],
            ]}
          />
        </Section>
        <Section title="Pick records">
          <Table
            head={['Item', 'Status', 'Picked', 'Picker', 'Final']}
            rows={order.lines.map((l) => [
              `${l.name}${l.substitutesLineId ? ' (substitute)' : ''}`,
              <Badge key="s" value={l.status} />,
              l.isWeighed
                ? l.actualWeightMlb === null
                  ? '–'
                  : `${(l.actualWeightMlb / 1000).toFixed(3)} lb`
                : (l.pickedQuantity ?? '–'),
              l.pickedBy ?? '–',
              cad(l.finalLineTotalCents),
            ])}
          />
        </Section>
      </div>
      {issue.status === 'open' && (
        <Section title="Decide">
          <ResolveIssue issueId={issue.id} needsScenario={issue.type === 'other'} />
        </Section>
      )}
      <Section title="This customer's earlier issues">
        <Table
          head={['Issue', 'Order', 'Type', 'Claimed', 'Status', 'Reported']}
          empty="None."
          rows={ctx.previousIssues.map((p) => [
            <A key="i" href={`/ops/issues/${p.id}`}>
              #{p.id}
            </A>,
            p.publicId,
            p.type,
            cad(p.claimedCents),
            <Badge key="s" value={p.status} />,
            when(p.createdAt),
          ])}
        />
      </Section>
    </div>
  )
}
