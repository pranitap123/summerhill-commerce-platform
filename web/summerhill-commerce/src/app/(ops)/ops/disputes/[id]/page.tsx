import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getOrder } from '@/modules/ordering'
import { getDispute, suggestedDisputeLiability } from '@/modules/payments'

import { ActionButton } from '../../_components/actions'
import { A, Badge, cad, Dl, PageTitle, Section, Table, when } from '../../_components/ui'
import { NotAuthorised } from '../../NotAuthorised'
import { requireOpsPage } from '../../requireAdminPage'

export const metadata: Metadata = { title: 'Dispute' }
export const dynamic = 'force-dynamic'

/** One dispute (G5-06): the evidence pack (incl. the handover record), submit, liability. */
export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ops = await requireOpsPage(`/ops/disputes/${raw}`, 'disputes.manage')
  if (!ops) return <NotAuthorised />
  const id = Number(raw)
  const d = Number.isInteger(id) && id > 0 ? await getDispute(id) : null
  if (!d) notFound()
  const order = (await getOrder(d.orderId))!
  const pack = d.evidence
  const suggested = suggestedDisputeLiability(order, !!pack?.handover.pickupCodeVerified)
  const open = ['needs_response', 'warning_needs_response'].includes(d.status)
  return (
    <div>
      <PageTitle sub={`${d.stripeDisputeId} · order ${d.publicId}`}>
        Dispute #{d.id} <Badge value={d.status} />
      </PageTitle>
      <Section title="Summary">
        <Dl
          items={[
            [
              'Order',
              <A key="o" href={`/ops/orders/${d.publicId}`}>
                {d.publicId}
              </A>,
            ],
            ['Reason', d.reason],
            ['Amount + Stripe fee', `${cad(d.amountCents)} + ${cad(d.feeCents)}`],
            ['Evidence due', when(d.evidenceDueBy)],
            ['Submitted', d.submittedAt ? `${when(d.submittedAt)} by ${d.submittedBy}` : 'not yet'],
            ['Liability', d.liability ?? `not set (matrix suggests: ${suggested})`],
            ['Recovered from merchant', cad(d.recoveredCents)],
            ['Reinstated by Stripe', cad(d.reinstatedCents)],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            path={`disputes/${d.id}/evidence`}
            variant="secondary"
            done="Evidence pack rebuilt"
          >
            Rebuild evidence pack
          </ActionButton>
          {open && (
            <ActionButton
              path={`disputes/${d.id}/submit`}
              confirm="Submit this evidence to Stripe? It can't be changed afterwards."
              done="Submitted"
            >
              Submit evidence to Stripe
            </ActionButton>
          )}
          {!d.liability && (
            <>
              <ActionButton
                path={`disputes/${d.id}/liability`}
                body={{ liability: 'platform' }}
                money
                variant="secondary"
              >
                Platform bears it
              </ActionButton>
              <ActionButton
                path={`disputes/${d.id}/liability`}
                body={{ liability: 'merchant' }}
                money
                variant="danger"
                confirm={`Recover ${cad(d.amountCents)} from the merchant with a transfer reversal?`}
              >
                Recover from merchant
              </ActionButton>
            </>
          )}
        </div>
      </Section>
      {pack ? (
        <Section title={`Evidence pack (built ${when(d.evidenceBuiltAt)})`}>
          <p className="mb-3 text-sm">{pack.summary}</p>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-semibold">Handover</h3>
              <Dl
                items={[
                  ['Collected', pack.handover.collected ? 'Yes' : 'No'],
                  ['At', when(pack.handover.collectedAt)],
                  ['Staff member', pack.handover.handedOverBy ?? '–'],
                  ['Pickup code verified', pack.handover.pickupCodeVerified ? 'Yes' : 'No'],
                  ['Wrong code attempts', pack.handover.wrongCodeAttempts],
                ]}
              />
              <h3 className="mb-2 mt-4 font-semibold">Receipt</h3>
              <Table
                head={['Item', 'Qty', 'Total']}
                rows={pack.receipt.map((r) => [r.name, r.quantity, cad(r.totalCents)])}
              />
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Emails sent</h3>
              <Table
                head={['When', 'Template', 'Status']}
                rows={pack.notifications.map((n) => [when(n.at), n.template, n.status])}
              />
              <h3 className="mb-2 mt-4 font-semibold">Not recorded</h3>
              <ul className="list-disc pl-5 text-sm">
                {pack.notRecorded.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
          <details className="mt-4 text-sm">
            <summary>Fields sent to Stripe</summary>
            <pre className="whitespace-pre-wrap text-xs">
              {JSON.stringify(pack.stripeEvidence, null, 2)}
            </pre>
          </details>
        </Section>
      ) : (
        <p>The evidence pack hasn&apos;t been built yet.</p>
      )}
    </div>
  )
}
