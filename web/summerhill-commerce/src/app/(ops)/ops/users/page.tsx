import type { Metadata } from 'next'

import { listTeam } from '@/modules/identity'
import { listMerchants } from '@/modules/merchant'

import { ActionButton } from '../_components/actions'
import { Badge, PageTitle, Section, Table } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'
import { InviteForm, MembershipEditor, RolesEditor } from './UserForms'

export const metadata: Metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

/**
 * Users and roles (G5-15, A11): platform staff (admin, support, finance) and store staff. Every
 * change is audited; the last admin can't be removed; deactivation ends sessions at once.
 */
export default async function UsersPage() {
  const ops = await requireOpsPage('/ops/users', 'users.manage')
  if (!ops) return <NotAuthorised />
  const [team, merchants] = await Promise.all([listTeam(), listMerchants()])
  const stores = merchants.map((m) => ({ id: m.id, name: m.name }))
  const me = String(ops.user.id)
  return (
    <div>
      <PageTitle sub="Staff must set up two-step verification at their first sign-in.">
        Users
      </PageTitle>
      <Section title="Invite">
        <InviteForm merchants={stores} />
      </Section>
      <Section title={`Staff (${team.length})`}>
        <Table
          head={['User', 'Platform roles', 'Store access', 'MFA', 'Status', '']}
          rows={team.map((u) => [
            <span key="u">
              {u.email}
              {u.name && <span className="block text-xs text-neutral-600">{u.name}</span>}
              {u.id === me && <span className="block text-xs">(you)</span>}
            </span>,
            u.id === me ? (
              u.roles.filter((r) => r !== 'customer').join(', ')
            ) : (
              <RolesEditor key="r" userId={u.id} roles={u.roles} />
            ),
            <div key="m" className="space-y-1">
              {u.memberships.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className={m.active ? '' : 'line-through text-neutral-500'}>
                    {m.merchantName}
                    {m.locationName ? ` (${m.locationName})` : ''}: {m.role}
                  </span>
                  {m.active && (
                    <ActionButton
                      method="DELETE"
                      path={`users/${u.id}/memberships/${m.merchantId}`}
                      variant="secondary"
                      confirm={`Remove ${u.email}'s access to ${m.merchantName}?`}
                    >
                      Remove
                    </ActionButton>
                  )}
                </div>
              ))}
              {!u.deactivatedAt && <MembershipEditor userId={u.id} merchants={stores} />}
            </div>,
            u.mfa.confirmed ? 'set up' : u.mfa.enrolled ? 'started' : 'not yet',
            u.deactivatedAt ? (
              <Badge key="s" value="deactivated" />
            ) : (
              <Badge key="s" value="active" />
            ),
            u.id === me ? null : (
              <span key="a" className="flex flex-wrap gap-2">
                {u.deactivatedAt ? (
                  <ActionButton path={`users/${u.id}/reactivate`} variant="secondary">
                    Reactivate
                  </ActionButton>
                ) : (
                  <ActionButton
                    path={`users/${u.id}/deactivate`}
                    variant="danger"
                    confirm={`Deactivate ${u.email}? Their sessions end immediately.`}
                  >
                    Deactivate
                  </ActionButton>
                )}
                {u.mfa.enrolled && (
                  <ActionButton
                    path={`users/${u.id}/reset-mfa`}
                    variant="secondary"
                    confirm="Reset two-step verification? They set it up again at next sign-in."
                  >
                    Reset MFA
                  </ActionButton>
                )}
              </span>
            ),
          ])}
        />
      </Section>
    </div>
  )
}
