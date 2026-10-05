import type { Metadata } from 'next'

import { listMerchants } from '@/modules/merchant'

import { A, Badge, PageTitle, Section, Table } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'
import { CreateMerchantForm } from './MerchantForms'

export const metadata: Metadata = { title: 'Merchants' }
export const dynamic = 'force-dynamic'

/** Merchants (G5-02, A1/A2): lifecycle and Stripe status at a glance. */
export default async function MerchantsPage() {
  const ops = await requireOpsPage('/ops/merchants', 'merchants.read')
  if (!ops) return <NotAuthorised />
  const merchants = await listMerchants()
  return (
    <div>
      <PageTitle>Merchants</PageTitle>
      <Section title="All merchants">
        <Table
          head={['Merchant', 'Lifecycle', 'Stripe', 'Charges', 'Payouts', 'Requirements due']}
          empty="No merchants yet. Run the seed script."
          rows={merchants.map((m) => [
            <A key="m" href={`/ops/merchants/${m.id}`}>
              {m.name}
            </A>,
            <Badge key="l" value={m.lifecycle_status} />,
            m.stripe_account_id ? (
              <span key="s">
                <Badge value={m.onboarding_status} />{' '}
                <span className="font-mono text-xs">
                  {m.stripe_account_type ?? ''} {m.stripe_account_id}
                </span>
              </span>
            ) : (
              'not onboarded'
            ),
            m.charges_enabled ? 'Yes' : 'No',
            m.payouts_enabled ? 'Yes' : 'No',
            m.requirements_due.join(', ') || m.disabled_reason || '',
          ])}
        />
      </Section>
      {ops.can('merchants.manage') && (
        <Section title="Add a merchant">
          <CreateMerchantForm />
        </Section>
      )}
    </div>
  )
}
