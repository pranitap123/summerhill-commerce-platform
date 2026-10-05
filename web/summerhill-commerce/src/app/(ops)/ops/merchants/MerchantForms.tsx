'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { buttonCls, inputCls, newKey, opsFetch, useOpsAction } from '../_components/actions'

/** New merchant with its first store, as a hidden draft (G5-02). */
export function CreateMerchantForm() {
  const router = useRouter()
  const { run, busy, feedback } = useOpsAction()
  const [f, setF] = useState({ name: '', slug: '', hst: '', store: 'Main store', city: 'Toronto' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () =>
            opsFetch('POST', 'merchants', {
              name: f.name,
              slug: f.slug,
              hstRegistrationNumber: f.hst || null,
              location: { slug: 'main', name: f.store, city: f.city || null, province: 'ON' },
            }),
          (r: { merchant: { id: number } }) => {
            router.push(`/ops/merchants/${r.merchant.id}`)
          },
        )
      }}
    >
      <label>
        <span className="block">Name</span>
        <input required value={f.name} onChange={set('name')} className={inputCls} />
      </label>
      <label>
        <span className="block">Slug</span>
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={f.slug}
          onChange={set('slug')}
          className={inputCls}
        />
      </label>
      <label>
        <span className="block">HST number (optional)</span>
        <input
          pattern="\d{9}RT\d{4}"
          placeholder="000000000RT0001"
          value={f.hst}
          onChange={set('hst')}
          className={inputCls}
        />
      </label>
      <label>
        <span className="block">First store</span>
        <input required value={f.store} onChange={set('store')} className={inputCls} />
      </label>
      <label>
        <span className="block">City</span>
        <input value={f.city} onChange={set('city')} className={inputCls} />
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        Create draft merchant
      </button>
      {feedback}
    </form>
  )
}

/** Stripe-hosted onboarding (Express): opens the link in this tab. */
export function OnboardingButton({ merchantId, label }: { merchantId: number; label: string }) {
  const { run, busy, feedback } = useOpsAction()
  return (
    <span>
      <button
        type="button"
        disabled={busy}
        className={buttonCls}
        onClick={() =>
          run(
            () => opsFetch('POST', `merchants/${merchantId}/onboarding-link`, {}),
            (r: { url: string }) => {
              window.location.assign(r.url)
            },
          )
        }
      >
        {label}
      </button>
      {feedback}
    </span>
  )
}

export function LifecycleButtons({
  merchantId,
  actions,
}: {
  merchantId: number
  actions: string[]
}) {
  const { run, busy, feedback } = useOpsAction()
  const labels: Record<string, string> = {
    go_live: 'Go live',
    pause: 'Pause (no new orders)',
    resume: 'Resume',
    offboard: 'Start offboarding',
    finish_offboarding: 'Finish offboarding (final payout)',
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            className={
              a === 'offboard'
                ? 'rounded bg-[#B3261E] px-3 py-1.5 text-sm text-white disabled:opacity-50'
                : buttonCls
            }
            onClick={() => {
              const reason =
                a === 'pause' || a === 'offboard'
                  ? window.prompt('Reason (shown in the audit log)')
                  : ''
              if (reason === null) return
              run(
                () =>
                  opsFetch('POST', `merchants/${merchantId}/lifecycle`, {
                    action: a,
                    ...(reason ? { reason } : {}),
                  }),
                (r: { status?: string }) => (r.status ? `Offboarding: ${r.status}` : 'Done'),
              )
            }}
          >
            {labels[a]}
          </button>
        ))}
      </div>
      {feedback}
    </div>
  )
}

export function PayoutForm({
  merchantId,
  availableCents,
}: {
  merchantId: number
  availableCents: number
}) {
  const { run, busy, feedback } = useOpsAction()
  const [key, setKey] = useState(newKey)
  const [amount, setAmount] = useState((availableCents / 100).toFixed(2))
  const [reason, setReason] = useState('')
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () =>
            opsFetch(
              'POST',
              `merchants/${merchantId}/payout`,
              { amountCents: Math.round(Number(amount) * 100), reason },
              key,
            ),
          (p: { status: string }) => {
            setKey(newKey())
            return p.status === 'pending_approval'
              ? 'Waiting for a second approver (over $5,000)'
              : `Payout ${p.status}`
          },
        )
      }}
    >
      <label>
        <span className="block">Amount (CAD)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputCls} w-28`}
        />
      </label>
      <label>
        <span className="block">Reason</span>
        <input
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputCls}
        />
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        Pay out
      </button>
      {feedback}
    </form>
  )
}

export function ScheduleForm({ merchantId, current }: { merchantId: number; current: string }) {
  const { run, busy, feedback } = useOpsAction()
  const [interval, setInterval] = useState(current)
  return (
    <span className="flex flex-wrap items-end gap-2 text-sm">
      <label>
        <span className="block">Automatic payouts</span>
        <select value={interval} onChange={(e) => setInterval(e.target.value)} className={inputCls}>
          {['manual', 'daily', 'weekly', 'monthly'].map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || interval === current}
        className={buttonCls}
        onClick={() =>
          run(
            () => opsFetch('POST', `merchants/${merchantId}/payout-schedule`, { interval }),
            () => 'Saved',
          )
        }
      >
        Save
      </button>
      {feedback}
    </span>
  )
}
