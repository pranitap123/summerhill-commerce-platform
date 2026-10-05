import type { Metadata } from 'next'

import { INVARIANTS, listReconRuns } from '@/modules/payouts'

import { A, Badge, Download, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'
import { RunReconciliation } from './RunReconciliation'

export const metadata: Metadata = { title: 'Reconciliation' }
export const dynamic = 'force-dynamic'

/** Reconciliation (G5-05, A10): daily runs, manual re-runs, the monthly close export. */
export default async function ReconciliationPage() {
  const ops = await requireOpsPage('/ops/reconciliation', 'recon.run')
  if (!ops) return <NotAuthorised />
  const runs = await listReconRuns(60)
  const month = new Date().toISOString().slice(0, 7)
  return (
    <div>
      <PageTitle sub="Runs daily at 06:00 (Toronto) for the previous day: Stripe's balance history against our payments, refunds and disputes, plus the ledger invariants.">
        Reconciliation
      </PageTitle>
      <Section title="Run a day now">
        <RunReconciliation />
        {ops.can('finance.read') && (
          <p className="mt-4 text-sm">
            Monthly close export (every ledger entry, CSV):{' '}
            <Download href={`/api/admin/reconciliation/close/${month}`}>{month}</Download>
          </p>
        )}
      </Section>
      <Section title="Runs">
        <Table
          head={['Run', 'Day', 'Trigger', 'Status', 'Matched', 'Mismatches', 'Started']}
          empty="No runs yet."
          rows={runs.map((r) => [
            <A key="r" href={`/ops/reconciliation/${r.id}`}>
              #{r.id}
            </A>,
            r.runDate,
            r.trigger,
            <Badge key="s" value={r.status} />,
            r.matched,
            r.mismatches,
            when(r.startedAt),
          ])}
        />
      </Section>
      <Section title="Invariants checked every run">
        <ul className="list-disc pl-5 text-sm">
          {Object.entries(INVARIANTS).map(([k, v]) => (
            <li key={k}>
              <code>{k}</code>: {v}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
