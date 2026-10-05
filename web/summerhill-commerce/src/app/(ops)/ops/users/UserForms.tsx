'use client'

import { useState } from 'react'

import { buttonCls, inputCls, opsFetch, useOpsAction } from '../_components/actions'

const PLATFORM = ['admin', 'support', 'finance'] as const

export function InviteForm({ merchants }: { merchants: Array<{ id: number; name: string }> }) {
  const { run, busy, feedback } = useOpsAction()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [store, setStore] = useState({ merchantId: 0, role: 'picker' })
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () =>
            opsFetch('POST', 'users', {
              email,
              name: name || null,
              roles,
              ...(store.merchantId
                ? {
                    membership: {
                      merchantId: store.merchantId,
                      locationId: null,
                      role: store.role,
                    },
                  }
                : {}),
            }),
          () => {
            setEmail('')
            setName('')
            return 'Invited: a password-setup email was sent'
          },
        )
      }}
    >
      <label>
        <span className="block">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </label>
      <label>
        <span className="block">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </label>
      <fieldset className="flex gap-2">
        <legend className="block">Platform roles</legend>
        {PLATFORM.map((r) => (
          <label key={r} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={roles.includes(r)}
              onChange={() =>
                setRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))
              }
            />
            {r}
          </label>
        ))}
      </fieldset>
      <label>
        <span className="block">Store access</span>
        <select
          value={store.merchantId}
          onChange={(e) => setStore((s) => ({ ...s, merchantId: Number(e.target.value) }))}
          className={inputCls}
        >
          <option value={0}>none</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {!!store.merchantId && (
        <label>
          <span className="block">Store role</span>
          <select
            value={store.role}
            onChange={(e) => setStore((s) => ({ ...s, role: e.target.value }))}
            className={inputCls}
          >
            <option>picker</option>
            <option>manager</option>
            <option>owner</option>
          </select>
        </label>
      )}
      <button type="submit" disabled={busy} className={buttonCls}>
        Invite
      </button>
      {feedback}
    </form>
  )
}

export function RolesEditor({ userId, roles }: { userId: string; roles: string[] }) {
  const { run, busy, feedback } = useOpsAction()
  const [value, setValue] = useState(roles.filter((r) => r !== 'customer'))
  const changed =
    value.slice().sort().join() !==
    roles
      .filter((r) => r !== 'customer')
      .sort()
      .join()
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {PLATFORM.map((r) => (
        <label key={r} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={value.includes(r)}
            onChange={() => setValue((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}
          />
          {r}
        </label>
      ))}
      {changed && (
        <button
          type="button"
          disabled={busy}
          className={buttonCls}
          onClick={() =>
            run(
              () => opsFetch('PUT', `users/${userId}/roles`, { roles: value }),
              () => 'Saved',
            )
          }
        >
          Save roles
        </button>
      )}
      {feedback}
    </span>
  )
}

export function MembershipEditor({
  userId,
  merchants,
}: {
  userId: string
  merchants: Array<{ id: number; name: string }>
}) {
  const { run, busy, feedback } = useOpsAction()
  const [merchantId, setMerchantId] = useState(merchants[0]?.id ?? 0)
  const [role, setRole] = useState('picker')
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="Store"
        value={merchantId}
        onChange={(e) => setMerchantId(Number(e.target.value))}
        className={inputCls}
      >
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Store role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className={inputCls}
      >
        <option>picker</option>
        <option>manager</option>
        <option>owner</option>
      </select>
      <button
        type="button"
        disabled={busy || !merchantId}
        className={buttonCls}
        onClick={() =>
          run(
            () =>
              opsFetch('PUT', `users/${userId}/memberships/${merchantId}`, {
                locationId: null,
                role,
              }),
            () => 'Store access saved',
          )
        }
      >
        Give store access
      </button>
      {feedback}
    </span>
  )
}
