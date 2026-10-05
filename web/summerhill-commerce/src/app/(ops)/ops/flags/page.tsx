import type { Metadata } from 'next'

import { listFlags } from '@/modules/ops'

import { ActionButton } from '../_components/actions'
import { Badge, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Flags' }
export const dynamic = 'force-dynamic'

/**
 * Feature flags and kill switches (G5-10, A13). Checkout off: new checkouts are refused within
 * 30 s and the storefront shows a banner. Per-merchant pause is on the merchant's page.
 */
export default async function FlagsPage() {
  const ops = await requireOpsPage('/ops/flags', 'flags.manage')
  if (!ops) return <NotAuthorised />
  const flags = await listFlags()
  return (
    <div>
      <PageTitle>Flags</PageTitle>
      <Section title="Flags">
        <Table
          head={['Flag', 'State', 'What it does', 'Last changed', '']}
          rows={flags.map((f) => [
            <code key="k">{f.key}</code>,
            <Badge key="s" value={f.enabled ? 'on' : 'off'} />,
            f.description,
            `${when(f.updatedAt)}${f.updatedBy ? ` by ${f.updatedBy}` : ''}`,
            <ActionButton
              key="t"
              method="PUT"
              path={`flags/${f.key}`}
              body={{ enabled: !f.enabled }}
              variant={f.enabled ? 'danger' : 'primary'}
              confirm={`Turn ${f.key} ${f.enabled ? 'off' : 'on'}?`}
            >
              Turn {f.enabled ? 'off' : 'on'}
            </ActionButton>,
          ])}
        />
      </Section>
    </div>
  )
}
