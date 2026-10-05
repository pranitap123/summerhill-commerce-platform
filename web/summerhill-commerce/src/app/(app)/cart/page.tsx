'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { SlotPicker } from '@/components/storefront/SlotPicker'
import type { PickupSlot } from '@/components/storefront/pickupTime'
import { useCartStore } from '@/lib/cartStore'
import { formatCad } from '@/utilities/money'

interface Slots {
  timeZone: string | null
  slots: PickupSlot[]
}

export default function CartPage() {
  const view = useCartStore((s) => s.view)
  const refresh = useCartStore((s) => s.refresh)
  const update = useCartStore((s) => s.update)
  const remove = useCartStore((s) => s.remove)

  const [loaded, setLoaded] = useState(false)
  const [slots, setSlots] = useState<Slots | null>(null)
  const [slotId, setSlotId] = useState<number | null>(null)
  const [email, setEmail] = useState('')
  const [pickupName, setPickupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [refresh])

  const items = view?.cart?.items ?? []
  const itemKey = items.map((i) => `${i.id}:${i.quantity}:${i.weightLb}`).join(',')
  useEffect(() => {
    if (!items.length) return setSlots(null)
    fetch('/api/v1/cart/slots')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Slots | null) => setSlots(s))
      .catch(() => setSlots(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])

  const quote = view?.quote
  const blocked = !quote || quote.issues.length > 0 || items.some((i) => !i.available)

  async function checkout() {
    if (!quote || slotId === null) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/v1/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        quoteHash: quote.hash,
        slotId,
        ...(email ? { email } : {}),
        ...(pickupName ? { pickupName } : {}),
      }),
    })
    const body = await res.json().catch(() => null)
    if (res.ok && body?.checkoutUrl) {
      window.location.href = body.checkoutUrl
      return
    }
    setError(body?.error?.message ?? 'Checkout could not start. Please review your cart.')
    setBusy(false)
    refresh().catch(() => {})
  }

  if (!loaded) return <div className="container py-12">Loading your cart…</div>

  if (!items.length)
    return (
      <div className="container py-12">
        <h1 className="mb-4 text-3xl font-semibold">Cart</h1>
        <p className="mb-6">Your cart is empty.</p>
        <Link href="/shop" className="underline">
          Browse the shop
        </Link>
      </div>
    )

  return (
    <div className="container grid gap-8 py-12 lg:grid-cols-[1fr_22rem]">
      <section aria-labelledby="cart-heading">
        <h1 id="cart-heading" className="mb-6 text-3xl font-semibold">
          Cart
        </h1>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.name}</p>
                <p className="text-sm text-neutral-600">
                  {item.weightLb !== null
                    ? `${item.weightLb} lb (est.), charged by actual weight`
                    : formatCad(item.effectivePriceCents)}
                </p>
                {!item.available && <p className="text-sm text-red-700">Currently unavailable</p>}
              </div>
              <div className="flex items-center gap-2">
                {item.quantity !== null && (
                  <>
                    <button
                      type="button"
                      aria-label={`Decrease ${item.name}`}
                      onClick={() => update(item.id, { quantity: item.quantity! - 1 })}
                      className="h-8 w-8 rounded border"
                    >
                      −
                    </button>
                    <span aria-live="polite">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${item.name}`}
                      onClick={() => update(item.id, { quantity: item.quantity! + 1 })}
                      className="h-8 w-8 rounded border"
                    >
                      +
                    </button>
                  </>
                )}
                <button type="button" onClick={() => remove(item.id)} className="ml-2 text-sm underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="h-fit space-y-4 rounded-xl bg-white p-6 shadow-sm" aria-label="Summary">
        <h2 className="text-lg font-semibold">Summary</h2>
        {quote && (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd>{formatCad(quote.itemSubtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Container deposits</dt>
              <dd>{formatCad(quote.depositCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>HST</dt>
              <dd>{formatCad(quote.taxCents)}</dd>
            </div>
            {quote.weightBufferCents > 0 && (
              <div className="flex justify-between">
                <dt>Temporary hold for weighed items</dt>
                <dd>{formatCad(quote.weightBufferCents)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 font-semibold">
              <dt>Card hold at checkout</dt>
              <dd>{formatCad(quote.authorizationCents)}</dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-neutral-600">
          Weighed items are estimates. We place a temporary hold on your card and charge only the
          final amount after your order is packed; the rest of the hold is released.
        </p>

        {slots?.timeZone && slots.slots.length > 0 && (
          <SlotPicker slots={slots.slots} timeZone={slots.timeZone} value={slotId} onChange={setSlotId} />
        )}
        {slots && slots.slots.length === 0 && (
          <p className="text-sm">No pickup times are available for this cart right now.</p>
        )}

        <label className="block text-sm">
          Email (for your order link)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Pickup name
          <input
            value={pickupName}
            onChange={(e) => setPickupName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={checkout}
          disabled={busy || blocked || slotId === null}
          className="w-full rounded-full bg-[#1F3A2E] px-6 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Starting checkout…' : 'Checkout'}
        </button>
      </aside>
    </div>
  )
}
