import type { Metadata } from 'next'

import { listIssues } from '@/modules/support'

import { A, Badge, cad, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Support issues' }
export const dynamic = 'force-dynamic'

/** The support queue (G5-11, ORDERS §10): open issues first, then what the policy decided. */
export default async function IssuesPage() {
  const ops = await requireOpsPage('/ops/issues', 'issues.resolve')
  if (!ops) return <NotAuthorised />
  const [open, all] = await Promise.all([listIssues({ status: 'open' }), listIssues()])
  const row = (i: (typeof all)[number]) => [
    <A key="i" href={`/ops/issues/${i.id}`}>
      #{i.id}
    </A>,
    <A key="o" href={`/ops/orders/${i.publicId}`}>
      <span className="font-mono">{i.publicId}</span>
    </A>,
    i.type.replace('_', ' '),
    cad(i.claimedCents),
    <Badge key="s" value={i.status} />,
    i.liability ?? '–',
    when(i.createdAt),
  ]
  const head = ['Issue', 'Order', 'Type', 'Claimed', 'Status', 'Liability', 'Reported']
  return (
    <div>
      <PageTitle sub="Claims up to $15 (and $30 per customer over 90 days) are refunded automatically; the rest wait here.">
        Support issues
      </PageTitle>
      <Section title={`Waiting for an agent (${open.length})`}>
        <Table head={head} empty="Queue is empty." rows={open.map(row)} />
      </Section>
      <Section title="Recent">
        <Table head={head} rows={all.filter((i) => i.status !== 'open').map(row)} />
      </Section>
    </div>
  )
}
