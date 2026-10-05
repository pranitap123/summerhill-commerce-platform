import type { Metadata } from 'next'

import { PAYOUT_APPROVAL_THRESHOLD_CENTS } from '@/modules/identity'
import { listPayouts } from '@/modules/payouts'

import { ActionButton } from '../_components/actions'
import { A, Badge, cad, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Payouts' }
export const dynamic = 'force-dynamic'

/**
 * Payouts (G5-07, A9): manual payouts above the threshold wait here for a second person; nobody
 * approves their own request. Automatic payouts arrive from Stripe's payout.* webhooks.
 */
export default async function PayoutsPage() {
  const ops = await requireOpsPage('/ops/payouts', 'payouts.manage')
  if (!ops) return <NotAuthorised />
  const [pending, recent] = await Promise.all([
    listPayouts({ status: 'pending_approval' }),
    listPayouts({ limit: 100 }),
  ])
  const me = String(ops.user.id)
  return (
    <div>
      <PageTitle
        sub={`Manual payouts over ${cad(PAYOUT_APPROVAL_THRESHOLD_CENTS)} need a second approver. Start a payout from the merchant's page.`}
      >
        Payouts
      </PageTitle>
      <Section title="Waiting for approval">
        <Table
          head={['Payout', 'Merchant', 'Amount', 'Reason', 'Requested by', 'Requested', '']}
          empty="Nothing waiting."
          rows={pending.map((p) => [
            `#${p.id}`,
            <A key="m" href={`/ops/merchants/${p.merchantId}`}>
              {p.merchantName}
            </A>,
            cad(p.amountCents),
            p.reason,
            p.requestedBy,
            when(p.createdAt),
            p.requestedBy === me ? (
              <span key="a" className="text-xs text-neutral-600">
                Your request: someone else must approve it
              </span>
            ) : ops.can('payouts.approve') ? (
              <span key="a" className="flex gap-2">
                <ActionButton
                  path={`payouts/${p.id}/decision`}
                  body={{ decision: 'approve' }}
                  money
                  confirm={`Approve a payout of ${cad(p.amountCents)} to ${p.merchantName}?`}
                >
                  Approve
                </ActionButton>
                <ActionButton
                  path={`payouts/${p.id}/decision`}
                  body={{ decision: 'reject' }}
                  money
                  variant="secondary"
                >
                  Reject
                </ActionButton>
              </span>
            ) : null,
          ])}
        />
      </Section>
      <Section title="Recent payouts">
        <Table
          head={[
            'Payout',
            'Merchant',
            'Amount',
            'Method',
            'Status',
            'Stripe',
            'Arrival',
            'Created',
          ]}
          rows={recent.map((p) => [
            `#${p.id}`,
            p.merchantName,
            cad(p.amountCents),
            p.method,
            <Badge key="s" value={p.status} />,
            <span key="st" className="font-mono text-xs">
              {p.stripePayoutId ?? '–'}
            </span>,
            p.arrivalDate ?? '–',
            when(p.createdAt),
          ])}
        />
      </Section>
    </div>
  )
}
