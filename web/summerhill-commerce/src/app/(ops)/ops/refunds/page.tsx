import type { Metadata } from 'next'

import { refundsByAgent } from '@/modules/payments'

import { cad, PageTitle, Section, Table } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Refunds by agent' }
export const dynamic = 'force-dynamic'

export default async function RefundsPage() {
  const ops = await requireOpsPage('/ops/refunds', 'finance.read')
  if (!ops) return <NotAuthorised />
  const [week, month] = await Promise.all([refundsByAgent(7), refundsByAgent(30)])
  const rows = (list: typeof week) =>
    list.map((r) => [r.createdBy, r.count, cad(r.totalCents), cad(r.largestCents)])
  return (
    <div>
      <PageTitle sub="Succeeded refunds per person (system = automatic refunds by the support policy).">
        Refunds by agent
      </PageTitle>
      <Section title="Last 7 days">
        <Table
          head={['Created by', 'Refunds', 'Total', 'Largest']}
          empty="No refunds."
          rows={rows(week)}
        />
      </Section>
      <Section title="Last 30 days">
        <Table
          head={['Created by', 'Refunds', 'Total', 'Largest']}
          empty="No refunds."
          rows={rows(month)}
        />
      </Section>
    </div>
  )
}
