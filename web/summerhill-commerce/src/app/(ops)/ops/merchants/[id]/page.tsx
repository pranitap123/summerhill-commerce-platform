import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getMerchantById, merchantHealth } from '@/modules/merchant'
import { listPayouts, merchantBalance, statementMonths } from '@/modules/payouts'

import { Badge, cad, Dl, Download, PageTitle, Section, Table, when } from '../../_components/ui'
import { NotAuthorised } from '../../NotAuthorised'
import { requireOpsPage } from '../../requireAdminPage'
import { LifecycleButtons, OnboardingButton, PayoutForm, ScheduleForm } from '../MerchantForms'

export const metadata: Metadata = { title: 'Merchant' }
export const dynamic = 'force-dynamic'

const ACTIONS: Record<string, string[]> = {
  draft: ['go_live', 'offboard'],
  live: ['pause', 'offboard'],
  paused: ['resume', 'offboard'],
  offboarding: ['finish_offboarding'],
  offboarded: [],
}

const secs = (s: number | null) =>
  s === null ? '–' : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`

export default async function MerchantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ onboarding?: string }>
}) {
  const { id: raw } = await params
  const ops = await requireOpsPage(`/ops/merchants/${raw}`, 'merchants.read')
  if (!ops) return <NotAuthorised />
  const id = Number(raw)
  const merchant = Number.isInteger(id) && id > 0 ? await getMerchantById(id) : null
  if (!merchant) notFound()
  const { onboarding } = await searchParams
  const [health, payouts, balance, months] = await Promise.all([
    merchantHealth(merchant),
    ops.can('payouts.manage') ? listPayouts({ merchantId: id, limit: 20 }) : [],
    ops.can('payouts.manage') && merchant.stripe_account_id
      ? merchantBalance(id).catch(() => null)
      : null,
    ops.can('finance.read') ? statementMonths(id) : [],
  ])
  const manage = ops.can('merchants.manage')
  return (
    <div>
      <PageTitle sub={`${merchant.slug} · created ${when(merchant.created_at)}`}>
        {merchant.name} <Badge value={merchant.lifecycle_status} />
      </PageTitle>
      {onboarding === 'done' && (
        <p role="status" className="mb-4 rounded bg-[#E3EFE6] p-3 text-sm">
          Back from onboarding. Stripe confirms the account with an account.updated webhook; the
          status below follows within seconds.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Stripe account">
          <Dl
            items={[
              [
                'Account',
                merchant.stripe_account_id
                  ? `${merchant.stripe_account_type ?? ''} ${merchant.stripe_account_id}`
                  : 'none yet',
              ],
              ['Status', <Badge key="s" value={merchant.onboarding_status} />],
              ['Charges enabled', merchant.charges_enabled ? 'Yes' : 'No'],
              ['Payouts enabled', merchant.payouts_enabled ? 'Yes' : 'No'],
              ['Disabled reason', merchant.disabled_reason ?? '–'],
              ['Requirements due', merchant.requirements_due.join(', ') || 'none'],
            ]}
          />
          {manage && merchant.lifecycle_status !== 'offboarded' && (
            <div className="mt-4 flex flex-wrap gap-2">
              <OnboardingButton
                merchantId={id}
                label={
                  merchant.stripe_account_id
                    ? 'Continue onboarding / update details'
                    : 'Start onboarding'
                }
              />
            </div>
          )}
        </Section>
        <Section title="Health (last 30 days)">
          <Dl
            items={[
              ['Go-live check', health.goLive.ok ? 'ready' : health.goLive.blockers.join('; ')],
              ['Published products', health.goLive.publishedProducts],
              ['Open orders', health.openOrders],
              ['Orders', health.last30Days.orders],
              [
                'Auto-rejected / store-rejected',
                `${health.last30Days.autoRejected} / ${health.last30Days.storeRejected}`,
              ],
              ['Median accept time', secs(health.last30Days.medianAcceptSeconds)],
              ['Median placed → ready', secs(health.last30Days.medianReadySeconds)],
              [
                'Last ingest',
                health.lastIngest
                  ? `#${health.lastIngest.id} ${health.lastIngest.status}, ${when(health.lastIngest.startedAt)}`
                  : 'never',
              ],
            ]}
          />
        </Section>
      </div>
      {manage && (
        <Section title="Lifecycle">
          <p className="mb-3 text-sm">
            Draft → live (needs charges enabled and a published catalogue) ⇄ paused → offboarding
            (no new orders, hidden) → offboarded (all orders closed, final payout).
            {merchant.lifecycle_reason && ` Last reason: ${merchant.lifecycle_reason}.`}
          </p>
          <LifecycleButtons merchantId={id} actions={ACTIONS[merchant.lifecycle_status]} />
        </Section>
      )}
      {ops.can('payouts.manage') && merchant.stripe_account_id && (
        <Section title="Payouts">
          <Dl
            items={[
              ['Available', cad(balance?.availableCents)],
              ['Pending', cad(balance?.pendingCents)],
            ]}
          />
          <div className="my-4 flex flex-wrap gap-6">
            <PayoutForm merchantId={id} availableCents={balance?.availableCents ?? 0} />
            <ScheduleForm merchantId={id} current={merchant.payout_schedule_interval} />
          </div>
          <Table
            head={[
              'Payout',
              'Amount',
              'Method',
              'Status',
              'Requested / approved by',
              'Arrival',
              'Created',
            ]}
            rows={payouts.map((p) => [
              `#${p.id}`,
              cad(p.amountCents),
              p.method,
              <Badge key="s" value={p.status} />,
              [p.requestedBy, p.approvedBy].filter(Boolean).join(' / '),
              p.arrivalDate ?? '–',
              when(p.createdAt),
            ])}
          />
        </Section>
      )}
      {ops.can('finance.read') && (
        <Section title="Monthly statements (from the ledger)">
          {months.length === 0 ? (
            <p className="text-sm">No money movements yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-4 text-sm">
              {months.map((m) => (
                <li key={m}>
                  {m}: <Download href={`/api/admin/merchants/${id}/statements/${m}`}>JSON</Download>{' '}
                  ·{' '}
                  <Download href={`/api/admin/merchants/${id}/statements/${m}?format=csv`}>
                    CSV
                  </Download>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  )
}
