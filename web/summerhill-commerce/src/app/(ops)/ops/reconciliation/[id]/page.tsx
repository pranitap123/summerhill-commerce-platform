import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getReconRun } from '@/modules/payouts'

import { A, Badge, cad, Dl, PageTitle, Section, Table, when } from '../../_components/ui'
import { NotAuthorised } from '../../NotAuthorised'
import { requireOpsPage } from '../../requireAdminPage'

export const metadata: Metadata = { title: 'Reconciliation run' }
export const dynamic = 'force-dynamic'

/** One reconciliation run and every difference it found (G5-05). */
export default async function ReconRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ops = await requireOpsPage(`/ops/reconciliation/${raw}`, 'recon.run')
  if (!ops) return <NotAuthorised />
  const id = Number(raw)
  const run = Number.isInteger(id) && id > 0 ? await getReconRun(id) : null
  if (!run) notFound()
  const s = run.summary as Record<string, unknown>
  return (
    <div>
      <PageTitle sub={`${run.trigger} run, started ${when(run.startedAt)}`}>
        Reconciliation {run.runDate} <Badge value={run.status} />
      </PageTitle>
      <Section title="Summary">
        <Dl
          items={[
            ['Stripe balance transactions', String(s.stripeTransactions ?? '–')],
            ['Matched to the cent', run.matched],
            ['Counted, not matched (transfers, fees, payouts)', String(s.informational ?? '–')],
            ['Late Stripe fees posted', String(s.processingFeesPosted ?? 0)],
            ['Mismatches', run.mismatches],
            ['Error', run.error ?? '–'],
          ]}
        />
      </Section>
      <Section title="Mismatches">
        <Table
          head={['Kind', 'Check', 'Order', 'Reference', 'Expected', 'Actual', 'Message']}
          empty="None: everything reconciled."
          rows={(run.items ?? []).map((i) => [
            <Badge key="k" value={i.kind} />,
            i.checkName,
            i.publicId ? (
              <A key="o" href={`/ops/orders/${i.publicId}`}>
                {i.publicId}
              </A>
            ) : (
              '–'
            ),
            <span key="r" className="font-mono text-xs">
              {i.reference ?? '–'}
            </span>,
            cad(i.expected),
            cad(i.actual),
            i.message,
          ])}
        />
      </Section>
    </div>
  )
}
