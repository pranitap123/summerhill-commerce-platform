import type { Metadata } from 'next'

import { listDisputes } from '@/modules/payments'

import { A, Badge, cad, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Disputes' }
export const dynamic = 'force-dynamic'

export default async function DisputesPage() {
  const ops = await requireOpsPage('/ops/disputes', 'disputes.manage')
  if (!ops) return <NotAuthorised />
  const disputes = await listDisputes()
  return (
    <div>
      <PageTitle sub="Stripe debits the platform for the amount and the CA$15 fee; submit evidence before the deadline.">
        Disputes
      </PageTitle>
      <Section title="All disputes">
        <Table
          head={[
            'Dispute',
            'Order',
            'Reason',
            'Amount',
            'Status',
            'Evidence due',
            'Liability',
            'Opened',
          ]}
          empty="No disputes."
          rows={disputes.map((d) => [
            <A key="d" href={`/ops/disputes/${d.id}`}>
              #{d.id}
            </A>,
            <A key="o" href={`/ops/orders/${d.publicId}`}>
              <span className="font-mono">{d.publicId}</span>
            </A>,
            d.reason,
            cad(d.amountCents),
            <Badge key="s" value={d.status} />,
            when(d.evidenceDueBy),
            d.liability ?? '–',
            when(d.createdAt),
          ])}
        />
      </Section>
    </div>
  )
}
