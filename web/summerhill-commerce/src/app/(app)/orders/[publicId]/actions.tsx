'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useCartStore } from '@/lib/cartStore'

/**
 * What the customer can do after paying (G4-12, G4-14, G4-15, G4-19). Every action goes through
 * the same access rule as the page (owner session or the signed guest link) and refreshes the
 * server-rendered page afterwards.
 */
function useOrderAction(publicId: string, token: string | null) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run(action: string, body: unknown = {}) {
    setBusy(action)
    setError(null)
    try {
      const qs = token ? `?t=${encodeURIComponent(token)}` : ''
      const res = await fetch(`/api/v1/orders/${publicId}/${action}${qs}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error?.message ?? 'Something went wrong')
      router.refresh()
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return null
    } finally {
      setBusy(null)
    }
  }
  return { run, busy, error }
}

const Alert = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="mt-2 text-sm text-[#B3261E]">
      {error}
    </p>
  ) : null

/** While the store works on the order, re-render every 15 s so replacements show up promptly. */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(t)
  }, [active, router])
  return null
}

export function CancelOrder({ publicId, token }: { publicId: string; token: string | null }) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="mt-4">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Cancel this order? The hold on your card is released.</span>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('cancel')}
            className="rounded bg-[#B3261E] px-3 py-1 text-white disabled:opacity-50"
          >
            Yes, cancel
          </button>
          <button type="button" className="underline" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="text-sm underline" onClick={() => setConfirming(true)}>
          Cancel order
        </button>
      )}
      <Alert error={error} />
    </div>
  )
}

export function SubstitutionDecision({
  publicId,
  token,
  lineId,
  decision,
}: {
  publicId: string
  token: string | null
  lineId: number
  decision: 'pending' | 'approved' | 'rejected' | null
}) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const decide = (d: 'approved' | 'rejected') => run(`substitutions/${lineId}`, { decision: d })
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {decision === 'rejected' ? (
        <>
          <span className="text-xs">Rejected: not charged.</span>
          <button
            type="button"
            disabled={!!busy}
            className="text-xs underline"
            onClick={() => decide('approved')}
          >
            Accept it after all
          </button>
        </>
      ) : (
        <>
          {decision === 'approved' && <span className="text-xs">Accepted.</span>}
          {decision === 'pending' && (
            <button
              type="button"
              disabled={!!busy}
              className="rounded border border-[#1F3A2E] px-2 text-xs"
              onClick={() => decide('approved')}
            >
              Accept
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            className="rounded border border-[#B3261E] px-2 text-xs text-[#B3261E]"
            onClick={() => decide('rejected')}
          >
            Reject (refund)
          </button>
        </>
      )}
      <Alert error={error} />
    </span>
  )
}

export function CheckIn({ publicId, token }: { publicId: string; token: string | null }) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const [note, setNote] = useState('')
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        run('arrived', { note: note.trim() || null })
      }}
    >
      <label className="flex-1 text-sm">
        Where are you? (optional)
        <input
          value={note}
          maxLength={140}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. blue car, spot 4"
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={!!busy}
        className="rounded-lg bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
      >
        I&apos;m here
      </button>
      <Alert error={error} />
    </form>
  )
}

const TAGS: Array<[string, string]> = [
  ['fresh', 'Fresh'],
  ['well_packed', 'Well packed'],
  ['good_substitutes', 'Good replacements'],
  ['quick_pickup', 'Quick pickup'],
  ['missing_items', 'Missing items'],
  ['poor_substitutes', 'Poor replacements'],
  ['damaged', 'Damaged'],
  ['long_wait', 'Long wait'],
]

export function RateOrder({
  publicId,
  token,
  current,
}: {
  publicId: string
  token: string | null
  current: { rating: number; tags: string[]; comment: string | null } | null
}) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const [rating, setRating] = useState(current?.rating ?? 0)
  const [tags, setTags] = useState<string[]>(current?.tags ?? [])
  const [comment, setComment] = useState(current?.comment ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await run('rating', { rating, tags, comment: comment.trim() || null })) setSaved(true)
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium">How was your order?</legend>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onClick={() => setRating(n)}
              className={`text-2xl ${n <= rating ? 'text-[#C28A00]' : 'text-neutral-300'}`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {TAGS.map(([value, label]) => (
          <label
            key={value}
            className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
          >
            <input
              type="checkbox"
              checked={tags.includes(value)}
              onChange={() =>
                setTags((t) => (t.includes(value) ? t.filter((x) => x !== value) : [...t, value]))
              }
            />
            {label}
          </label>
        ))}
      </div>
      <textarea
        value={comment}
        maxLength={500}
        onChange={(e) => setComment(e.target.value)}
        aria-label="Comment (optional)"
        placeholder="Anything we should know? (optional)"
        className="w-full rounded border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={!rating || !!busy}
        className="rounded-lg bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
      >
        {current ? 'Update rating' : 'Send rating'}
      </button>
      {saved && <p className="text-sm">Thanks for the feedback!</p>}
      <Alert error={error} />
    </form>
  )
}

export function BuyAgain({ publicId, token }: { publicId: string; token: string | null }) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const refresh = useCartStore((s) => s.refresh)
  const [result, setResult] = useState<{ added: number; unavailable: string[] } | null>(null)
  const [mixed, setMixed] = useState(false)
  async function reorder(replaceCart: boolean) {
    const data = await run('reorder', replaceCart ? { replaceCart } : {})
    if (!data) {
      setMixed(true)
      return
    }
    setMixed(false)
    await refresh().catch(() => {})
    setResult({
      added: data.added.length,
      unavailable: data.unavailable.map((u: { name: string }) => u.name),
    })
  }
  return (
    <div>
      <button
        type="button"
        disabled={!!busy}
        onClick={() => reorder(false)}
        className="rounded-lg border border-[#1F3A2E] px-4 py-2 disabled:opacity-50"
      >
        Buy again
      </button>
      {mixed && error && (
        <p className="mt-2 text-sm">
          {error}{' '}
          <button type="button" className="underline" onClick={() => reorder(true)}>
            Start a new cart
          </button>
        </p>
      )}
      {result && (
        <p className="mt-2 text-sm" role="status">
          {result.added} item{result.added === 1 ? '' : 's'} added to your{' '}
          <Link href="/cart" className="underline">
            cart
          </Link>
          .
          {result.unavailable.length > 0 && (
            <> Not available now: {result.unavailable.join(', ')}.</>
          )}
        </p>
      )}
    </div>
  )
}

const ISSUE_TYPES = [
  ['missing', 'Something was missing'],
  ['damaged', 'Damaged or spoiled'],
  ['wrong_item', 'Wrong item or replacement'],
  ['quality', 'Quality problem'],
  ['other', 'Something else'],
] as const

/**
 * "Report a problem" (G5-11): within 48 h of pickup. Small claims are refunded at once; the rest
 * go to our support team, who reply by email.
 */
export function ReportProblem({
  publicId,
  token,
  lines,
}: {
  publicId: string
  token: string | null
  lines: Array<{ lineId: number; name: string; quantity: number | null; weighed: boolean }>
}) {
  const { run, busy, error } = useOrderAction(publicId, token)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('missing')
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [description, setDescription] = useState('')
  const [result, setResult] = useState<{ refunded: boolean; claimedCents: number } | null>(null)
  if (result)
    return (
      <p role="status" className="text-sm">
        {result.refunded
          ? `Sorry about that. We refunded ${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(result.claimedCents / 100)} to your card.`
          : 'Thanks. Our support team will look at it and email you.'}
      </p>
    )
  if (!open)
    return (
      <button type="button" className="text-sm underline" onClick={() => setOpen(true)}>
        Report a problem with this order
      </button>
    )
  const toggle = (lineId: number, qty: number) =>
    setPicked((p) => {
      const next = { ...p }
      if (next[lineId]) delete next[lineId]
      else next[lineId] = qty
      return next
    })
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault()
        const data = await run('issues', {
          type,
          lines: Object.entries(picked).map(([lineId, quantity]) => ({
            lineId: Number(lineId),
            ...(quantity ? { quantity } : {}),
          })),
          description: description.trim() || null,
        })
        if (data) setResult({ refunded: data.refunded, claimedCents: data.claimedCents })
      }}
    >
      <h2 className="font-semibold">Report a problem</h2>
      <label className="block">
        <span className="mb-1 block">What went wrong?</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded border px-2 py-1"
        >
          {ISSUE_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1">Which items?</legend>
        {lines.map((l) => (
          <div key={l.lineId} className="flex items-center gap-2">
            <input
              id={`issue-line-${l.lineId}`}
              type="checkbox"
              checked={l.lineId in picked}
              onChange={() => toggle(l.lineId, 0)}
            />
            <label htmlFor={`issue-line-${l.lineId}`}>{l.name}</label>
            {l.lineId in picked && !l.weighed && (l.quantity ?? 1) > 1 && (
              <label className="ml-2">
                how many?{' '}
                <input
                  type="number"
                  min={1}
                  max={l.quantity ?? 1}
                  value={picked[l.lineId] || l.quantity || 1}
                  onChange={(e) => setPicked((p) => ({ ...p, [l.lineId]: Number(e.target.value) }))}
                  className="w-16 rounded border px-1"
                />
              </label>
            )}
          </div>
        ))}
      </fieldset>
      <label className="block">
        <span className="mb-1 block">Anything else we should know? (optional)</span>
        <textarea
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border p-2"
          rows={3}
        />
      </label>
      <button
        type="submit"
        disabled={!!busy || (type !== 'other' && !Object.keys(picked).length)}
        className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
      >
        Send report
      </button>
      <Alert error={error} />
    </form>
  )
}
