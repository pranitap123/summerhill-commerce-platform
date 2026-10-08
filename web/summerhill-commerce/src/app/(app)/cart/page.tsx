'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { ReplacementChooser } from '@/components/storefront/ReplacementChooser'
import { SlotPicker } from '@/components/storefront/SlotPicker'
import { formatPickupWindow, type PickupSlot } from '@/components/storefront/pickupTime'
import {
  CartApiError,
  useCartStore,
  type CartItemView,
  type Quote,
  type ReplacementPreference,
} from '@/lib/cartStore'
import { useAuth } from '@/providers/Auth'
import { formatCad, formatLb, formatUnitPrice } from '@/utilities/money'

const REPLACEMENT_LABELS: Record<ReplacementPreference, string> = {
  best_match: 'Best match',
  specific: 'Specific item',
  refund: "Don't replace (refund)",
}

function Line({ item }: { item: CartItemView }) {
  const update = useCartStore((s) => s.update)
  const remove = useCartStore((s) => s.remove)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }
  const byWeight = item.sellBy === 'weight' && item.pricingModel === 'per_weight'
  const weighed = item.pricingModel === 'per_weight'

  return (
    <li className="flex gap-4 border-b border-[#DCE5D8] py-4">
      {item.image && (
        // eslint-disable-next-line @next/next/no-img-element -- placeholder images until the CDN (G3)
        <img src={item.image} alt="" className="h-16 w-16 rounded object-cover" />
      )}
      <div className="flex-1">
        <div className="flex justify-between gap-4">
          <Link href={`/products/${encodeURIComponent(item.productId)}`} className="font-medium">
            {item.name}
          </Link>
          <span className="font-semibold whitespace-nowrap">
            {item.line ? formatCad(item.line.lineTotalCents) : '–'}
            {weighed && item.line && <span className="text-xs font-normal"> est.</span>}
          </span>
        </div>
        <p className="text-sm text-neutral-600">
          {item.effectivePriceCents !== null &&
            formatUnitPrice(item.effectivePriceCents, item.unit)}
          {item.promoLabel && (
            <span className="ml-2 rounded bg-[#B3261E] px-1 text-xs text-white">
              {item.promoLabel}
            </span>
          )}
          {weighed && item.line?.estimatedWeightMlb && (
            <> · est. {formatLb(item.line.estimatedWeightMlb / 1000)}, charged by actual weight</>
          )}
          {item.line && item.line.taxCents > 0 && <> · HST {formatCad(item.line.taxCents)}</>}
          {item.line && item.line.depositCents > 0 && (
            <> · deposit {formatCad(item.line.depositCents)}</>
          )}
        </p>
        {!item.available && (
          <p className="text-sm text-[#B3261E]">No longer available; remove it to continue.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {byWeight ? (
            <label className="flex items-center gap-1">
              Weight
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.25}
                defaultValue={item.weightLb ?? 1}
                disabled={busy}
                aria-label={`Weight of ${item.name} in pounds`}
                className="w-20 rounded border px-2 py-1"
                onBlur={(e) => {
                  const w = Number(e.target.value)
                  if (w && w !== item.weightLb) run(() => update(item.id, { weightLb: w }))
                }}
              />
              lb
            </label>
          ) : (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`One fewer ${item.name}`}
                disabled={busy}
                className="rounded border px-2"
                onClick={() => run(() => update(item.id, { quantity: (item.quantity ?? 1) - 1 }))}
              >
                −
              </button>
              <span aria-live="polite" className="w-6 text-center">
                {item.quantity}
              </span>
              <button
                type="button"
                aria-label={`One more ${item.name}`}
                disabled={busy}
                className="rounded border px-2"
                onClick={() => run(() => update(item.id, { quantity: (item.quantity ?? 0) + 1 }))}
              >
                +
              </button>
            </span>
          )}
          <label className="flex items-center gap-1">
            If unavailable
            <select
              value={item.replacementPreference}
              disabled={busy}
              className="rounded border bg-white px-1 py-1"
              onChange={(e) => {
                const preference = e.target.value as ReplacementPreference
                if (preference === 'specific') setChoosing(true)
                else run(() => update(item.id, { replacementPreference: preference }))
              }}
            >
              {(['best_match', 'specific', 'refund'] as const).map((p) => (
                <option key={p} value={p}>
                  {REPLACEMENT_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            className="text-[#B3261E] underline"
            onClick={() => run(() => remove(item.id))}
          >
            Remove
          </button>
        </div>
        {item.replacementPreference === 'specific' && !choosing && (
          <p className="mt-1 text-xs text-neutral-600">
            {item.replacementProductIds.length} replacement choice
            {item.replacementProductIds.length === 1 ? '' : 's'} ·{' '}
            <button type="button" className="underline" onClick={() => setChoosing(true)}>
              change
            </button>
          </p>
        )}
        {choosing && (
          <ReplacementChooser
            lineId={item.id}
            selected={item.replacementProductIds}
            onCancel={() => setChoosing(false)}
            onSave={async (ids) => {
              await update(item.id, {
                replacementPreference: 'specific',
                replacementProductIds: ids,
              })
              setChoosing(false)
            }}
          />
        )}
        {error && (
          <p role="alert" className="mt-1 text-sm text-[#B3261E]">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

function Breakdown({ quote }: { quote: Quote }) {
  const row = (label: string, cents: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'text-lg font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{formatCad(cents)}</dd>
    </div>
  )
  return (
    <dl className="space-y-1">
      {row('Items', quote.itemSubtotalCents)}
      {quote.depositCents > 0 && row('Container deposits', quote.depositCents)}
      {row('HST', quote.taxCents)}
      {row('Estimated total', quote.estimatedTotalCents, true)}
      {quote.weightBufferCents > 0 && (
        <>
          <div className="flex justify-between text-neutral-700">
            <dt>Temporary hold for weighed items ({quote.weightBufferBp / 100}%)</dt>
            <dd>{formatCad(quote.weightBufferCents)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Card hold at checkout</dt>
            <dd>{formatCad(quote.authorizationCents)}</dd>
          </div>
        </>
      )}
    </dl>
  )
}

const newKey = () => `checkout-${crypto.randomUUID()}`

interface SlotsView {
  timeZone: string | null
  paused: boolean
  slots: PickupSlot[]
}

function CartContent() {
  const { view, loading, refresh, reset } = useCartStore()
  const { user } = useAuth()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [pickupName, setPickupName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slots, setSlots] = useState<SlotsView | null>(null)
  const [slotId, setSlotId] = useState<number | null>(null)

  const idempotency = useRef<{ hash: string; key: string; slotId: number | null } | null>(null)

  useEffect(() => {
    refresh().catch(() => setError('We could not load your cart. Please refresh the page.'))
  }, [refresh])

  const quote = view?.quote ?? null
  const items = view?.cart?.items ?? []
  const itemKey = items.map((i) => i.productId).join(',')

  const applySlots = useCallback((data: SlotsView) => {
    setSlots(data)

    setSlotId((current) => (data.slots.some((s) => s.id === current) ? current : null))
  }, [])
  const loadSlots = useCallback(
    async () =>
      applySlots(await (await fetch('/api/v1/cart/slots', { credentials: 'include' })).json()),
    [applySlots],
  )

  useEffect(() => {
    if (!itemKey) return
    let live = true
    fetch('/api/v1/cart/slots', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: SlotsView) => live && applySlots(data))
      .catch(() => live && setSlots(null))
    return () => {
      live = false
    }
  }, [itemKey, applySlots])

  async function checkout(e: React.FormEvent) {
    e.preventDefault()
    if (!quote) return
    if (!slotId) {
      setError('Please choose a pickup time.')
      return
    }
    setSubmitting(true)
    setError(null)
    if (idempotency.current?.hash !== quote.hash || idempotency.current.slotId !== slotId)
      idempotency.current = { hash: quote.hash, key: newKey(), slotId }
    try {
      const res = await fetch('/api/v1/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotency.current.key,
        },
        body: JSON.stringify({
          quoteHash: quote.hash,
          slotId,
          ...(user ? {} : { email }),
          ...(pickupName.trim() ? { pickupName: pickupName.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        reset()
        window.location.href = data.checkoutUrl
        return
      }
      const code = data?.error?.code
      if (code === 'PRICE_CHANGED' || code === 'QUOTE_EXPIRED') {
        await refresh()
        setError(
          code === 'PRICE_CHANGED'
            ? 'Prices or availability changed since you last looked. Please review the new total.'
            : 'Please confirm the total again before paying.',
        )
      } else if (code === 'SLOT_UNAVAILABLE' || code === 'SLOT_INVALID') {
        await loadSlots()
        setError(data.error.message)
      } else setError(data?.error?.message ?? 'Checkout failed. Please try again.')
    } catch (err) {
      setError(
        err instanceof CartApiError
          ? err.message
          : 'Checkout failed. Please check your connection and try again.',
      )
    }
    setSubmitting(false)
  }

  if (loading && !view) return <div className="mx-auto max-w-3xl px-4 py-10">Loading cart…</div>
  if (!items.length)
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-4 text-2xl font-semibold">Cart</h1>
        <p>
          Your cart is empty. <Link href="/shop">Continue shopping</Link>
        </p>
      </div>
    )

  const blocking = quote?.issues.filter((i) => i.code !== 'BELOW_MINIMUM') ?? []
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 md:grid-cols-[1fr_22rem]">
      <section>
        <h1 className="mb-2 text-2xl font-semibold">Cart</h1>
        {params.get('checkout') === 'cancelled' && (
          <p className="mb-4 rounded bg-[#FFF4D6] p-3 text-sm">
            Checkout was cancelled. Nothing was charged; your cart is still here.
          </p>
        )}
        <ul>
          {items.map((item) => (
            <Line key={item.id} item={item} />
          ))}
        </ul>
      </section>

      <aside className="h-fit rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Summary</h2>
        {quote && <Breakdown quote={quote} />}
        {quote && quote.weightBufferCents > 0 && (
          <p className="mt-3 text-sm text-neutral-700">
            Weighed items are estimates. We place a temporary hold on your card and charge only the
            final amount after your order is packed; the rest of the hold is released.
          </p>
        )}
        {quote && !quote.meetsMinimum && (
          <p className="mt-3 text-sm text-[#B3261E]">
            The minimum order is {formatCad(quote.minimumOrderCents)} of items. Add{' '}
            {formatCad(quote.minimumOrderCents - quote.itemSubtotalCents)} more to check out.
          </p>
        )}
        {blocking.map((i) => (
          <p key={`${i.code}-${i.productId}`} className="mt-2 text-sm text-[#B3261E]">
            {i.message}
          </p>
        ))}

        <form onSubmit={checkout} className="mt-6 space-y-3">
          {slots?.paused ? (
            <p className="rounded bg-[#FFF4D6] p-3 text-sm">
              This store is not taking orders right now. Please try again later.
            </p>
          ) : slots && slots.timeZone && slots.slots.length > 0 ? (
            <SlotPicker
              slots={slots.slots}
              timeZone={slots.timeZone}
              value={slotId}
              onChange={setSlotId}
            />
          ) : slots ? (
            <p className="text-sm text-[#B3261E]">
              No pickup times are available in the next 5 days for these items.
            </p>
          ) : null}
          {slotId && slots?.timeZone && (
            <p className="text-sm">
              Pickup:{' '}
              <strong>
                {(() => {
                  const s = slots.slots.find((x) => x.id === slotId)!
                  return formatPickupWindow(s.startsAt, s.endsAt, slots.timeZone)
                })()}
              </strong>
            </p>
          )}
          {user ? (
            <p className="text-sm">Receipt to {user.email}</p>
          ) : (
            <label className="block text-sm">
              Email for your receipt
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          )}
          <label className="block text-sm">
            Pickup name (optional)
            <input
              value={pickupName}
              maxLength={100}
              autoComplete="name"
              onChange={(e) => setPickupName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={!quote?.canCheckout || !slotId || submitting}
            className="w-full rounded-lg bg-[#1F3A2E] px-6 py-3 text-white hover:bg-[#16291F] disabled:opacity-50"
          >
            {submitting
              ? 'Redirecting to payment…'
              : `Pay securely · hold ${formatCad(quote?.authorizationCents ?? 0)}`}
          </button>
          <p className="text-xs text-neutral-600">
            Test mode: use card 4242 4242 4242 4242. No real money moves.
          </p>
          {error && (
            <p role="alert" className="text-sm text-[#B3261E]">
              {error}
            </p>
          )}
        </form>
      </aside>
    </div>
  )
}

export default function CartPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-10">Loading cart…</div>}>
      <CartContent />
    </Suspense>
  )
}
