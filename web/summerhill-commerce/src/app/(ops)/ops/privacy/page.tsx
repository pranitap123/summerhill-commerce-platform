import type { Metadata } from 'next'

import { listPrivacyRequests, RETENTION } from '@/modules/privacy'

import { PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'
import { PrivacyForms } from './PrivacyForms'

export const metadata: Metadata = { title: 'Privacy' }
export const dynamic = 'force-dynamic'

/**
 * Data subject requests and retention (G5-16, G5-17, SECURITY §7). Customers can also do both
 * from their account page.
 */
export default async function PrivacyPage() {
  const ops = await requireOpsPage('/ops/privacy', 'privacy.manage')
  if (!ops) return <NotAuthorised />
  const requests = await listPrivacyRequests()
  return (
    <div>
      <PageTitle sub="Orders are kept 7 years for tax records; deletion anonymises the contact details on them.">
        Privacy
      </PageTitle>
      <Section title="Handle a request">
        <PrivacyForms />
      </Section>
      <Section title="Handled requests (no personal data stored here)">
        <Table
          head={['#', 'Kind', 'By', 'Summary', 'When']}
          empty="None yet."
          rows={requests.map((r) => [
            r.id,
            r.kind,
            r.requested_by,
            <code key="s" className="text-xs">
              {JSON.stringify(r.summary)}
            </code>,
            when(r.completed_at),
          ])}
        />
      </Section>
      <Section title="Retention (weekly purge job)">
        <ul className="list-disc pl-5 text-sm">
          <li>Order contact details: anonymised after {RETENTION.orderContactYears} years</li>
          <li>
            Email log: deleted after {RETENTION.notificationDays} days (recipients are stored
            hashed)
          </li>
          <li>Search analytics: deleted after 13 months</li>
          <li>Stripe webhook payloads: redacted after {RETENTION.webhookPayloadDays} days</li>
          <li>Payment simulator records: deleted after {RETENTION.simulatorDays} days</li>
        </ul>
      </Section>
    </div>
  )
}
