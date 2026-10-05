'use client'

import { useEffect, useState } from 'react'

import { consoleApi } from '../../_lib/api'

interface Toggles {
  products: Array<{ productId: string; name: string; hiddenUntil: string }>
  categories: Array<{ categoryId: number; name: string; hiddenUntil: string }>
  allCategories: Array<{ categoryId: number; name: string; products: number }>
}

interface SearchItem {
  id: string
  name: string
  merchantId: number
}

/**
 * "Out of stock today" (G4-20, M11): hide a product or a whole category from the storefront until
 * the store next opens. It comes back by itself; "Back in stock" undoes it sooner.
 */
export function Availability({
  locationId,
  merchantId,
  timeZone,
}: {
  locationId: number
  merchantId: number
  timeZone: string
}) {
  const [toggles, setToggles] = useState<Toggles | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `locations/${locationId}/availability`
  const until = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))

  useEffect(() => {
    let live = true
    consoleApi<Toggles>('GET', base)
      .then((t) => live && setToggles(t))
      .catch((e: Error) => live && setMessage(e.message))
    return () => {
      live = false
    }
  }, [base])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setToggles(await consoleApi<Toggles>('GET', base))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const product = (id: string, outOfStock: boolean) =>
    run(() => consoleApi('PUT', `${base}/products/${encodeURIComponent(id)}`, { outOfStock }))
  const category = (id: number, outOfStock: boolean) =>
    run(() => consoleApi('PUT', `${base}/categories/${id}`, { outOfStock }))

  const hiddenCategories = new Map(toggles?.categories.map((c) => [c.categoryId, c]) ?? [])
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4">
      {message && (
        <p role="alert" className="rounded bg-[#B3261E] px-4 py-2 text-white">
          {message}
        </p>
      )}
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Products hidden today</h2>
        {toggles?.products.length === 0 && <p className="text-sm">None.</p>}
        <ul className="space-y-1">
          {toggles?.products.map((p) => (
            <li key={p.productId} className="flex flex-wrap items-center gap-3">
              <span className="flex-1">{p.name}</span>
              <span className="text-sm text-neutral-600">until {until(p.hiddenUntil)}</span>
              <button
                type="button"
                disabled={busy}
                className="rounded border px-3 py-1"
                onClick={() => product(p.productId, false)}
              >
                Back in stock
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!query.trim()) return
            const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query.trim())}&limit=10`)
            const data = await res.json().catch(() => null)
            setResults((data?.items ?? []).filter((i: SearchItem) => i.merchantId === merchantId))
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a product to hide"
            aria-label="Find a product"
            className="flex-1 rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-[#1F3A2E] px-4 py-2 text-white">
            Search
          </button>
        </form>
        {results && (
          <ul className="mt-2 space-y-1">
            {results.length === 0 && <li className="text-sm">No visible products match.</li>}
            {results.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <span className="flex-1">{r.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-[#B3261E] px-3 py-1 text-[#B3261E]"
                  onClick={() => product(r.id, true).then(() => setResults(null))}
                >
                  Out of stock today
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Whole categories</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {toggles?.allCategories.map((c) => {
            const hidden = hiddenCategories.get(c.categoryId)
            return (
              <li
                key={c.categoryId}
                className="flex items-center justify-between gap-2 rounded border px-3 py-2"
              >
                <span>
                  {c.name} <span className="text-sm text-neutral-600">({c.products})</span>
                  {hidden && (
                    <span className="block text-xs text-[#B3261E]">
                      Hidden until {until(hidden.hiddenUntil)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={!!hidden}
                  onClick={() => category(c.categoryId, !hidden)}
                  className={`rounded px-3 py-1 text-sm ${hidden ? 'bg-[#B3261E] text-white' : 'border'}`}
                >
                  {hidden ? 'Back in stock' : 'Out today'}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
