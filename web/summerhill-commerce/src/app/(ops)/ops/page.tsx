import type { Metadata } from 'next'

import { listIngestRuns } from '@/modules/catalog'
import { listAlerts } from '@/modules/ops'
import { listDisputes } from '@/modules/payments'
import { listPayouts, listReconRuns } from '@/modules/payouts'
import { listIssues } from '@/modules/support'

import { ActionButton } from './_components/actions'
import { A, Badge, PageTitle, Section, Table, when } from './_components/ui'
import { NotAuthorised } from './NotAuthorised'
import { requireOpsPage } from './requireAdminPage'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function OpsHome() {
  const ops = await requireOpsPage('/ops')
  if (!ops) return <NotAuthorised />
  const [alerts, issues, disputes, payouts, runs, recon] = await Promise.all([
    listAlerts({ open: true, limit: 20 }),
    ops.can('issues.resolve') ? listIssues({ status: 'open' }) : [],
    ops.can('disputes.manage') ? listDisputes({ open: true }) : [],
    ops.can('payouts.approve') ? listPayouts({ status: 'pending_approval' }) : [],
    ops.can('catalog.manage') ? listIngestRuns(10) : [],
    ops.can('recon.run') ? listReconRuns(1) : [],
  ])
  const held = runs.filter((r) => r.status === 'held')
  const tiles: Array<[string, number | string, string, boolean]> = [
    ['Open alerts', alerts.length, '/ops', true],
    ['Support issues waiting', issues.length, '/ops/issues', ops.can('issues.resolve')],
    ['Disputes open', disputes.length, '/ops/disputes', ops.can('disputes.manage')],
    ['Payouts to approve', payouts.length, '/ops/payouts', ops.can('payouts.approve')],
    ['Held catalogue runs', held.length, '/ops/catalog', ops.can('catalog.manage')],
    [
      'Last reconciliation',
      recon[0] ? `${recon[0].runDate}: ${recon[0].status}` : 'none yet',
      '/ops/reconciliation',
      ops.can('recon.run'),
    ],
  ]
  return (
    <div>
      <PageTitle sub={`Signed in as ${ops.user.email}`}>Dashboard</PageTitle>
      <ul className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles
          .filter(([, , , show]) => show)
          .map(([label, value, href]) => (
            <li key={label} className="rounded-xl bg-white p-4 shadow-sm">
              <A href={href}>{label}</A>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </li>
          ))}
      </ul>
      <Section title="Open alerts">
        <Table
          head={['When', 'Severity', 'Kind', 'Message', '']}
          empty="No open alerts."
          rows={alerts.map((a) => [
            when(a.createdAt),
            <Badge key="s" value={a.severity} />,
            a.kind,
            a.message,
            <ActionButton key="r" path={`alerts/${a.id}/resolve`} variant="secondary">
              Resolve
            </ActionButton>,
          ])}
        />
      </Section>
    </div>
  )
}
