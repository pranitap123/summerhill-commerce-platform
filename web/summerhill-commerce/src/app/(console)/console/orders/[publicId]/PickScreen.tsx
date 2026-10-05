'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { ConsoleApiError, consoleApi, money, storeTime } from '../../_lib/api'
import { LineCard, SubstitutePanel, type PickBody, type SubBody } from './LineCard'
import { Scanner } from './Scanner'
import type { ConsoleOrder, Line, ScanResult } from './types'

type Pending =
  | { kind: 'confirm'; message: string; yes: string; run(): Promise<void> }
  | { kind: 'reject' }
  | { kind: 'outOfStock'; productId: string; name: string }
  | null

const REJECT_REASONS: Array<[string, string]> = [
  ['too_busy', 'Too busy'],
  ['items_unavailable', 'Items unavailable'],
  ['closing', 'Closing'],
  ['other', 'Other'],
]

/**
 * The pick screen (G4-07…G4-14). Everything a store worker does with one order on a tablet:
 * accept or reject, claim it, pick line by line (scan, weigh, replace), complete (which charges
 * the final amount), and hand over with the customer's pickup code.
 */
export function PickScreen({
  initial,
  locationId,
  timeZone,
  me,
}: {
  initial: ConsoleOrder
  locationId: number
  timeZone: string
  me: string
}) {
  const [order, setOrder] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [scanFor, setScanFor] = useState<{ lineId: number; code: string } | null>(null)
  const [subPreset, setSubPreset] = useState<{
    line: Line
    productId: string
    code: string
  } | null>(null)
  const [code, setCode] = useState('')
  const path = `orders/${order.publicId}`

  // Picks up customer answers to replacements and "I'm here" while the screen is open.
  useEffect(() => {
    if (['collected', 'cancelled', 'abandoned'].includes(order.status)) return
    const t = setInterval(() => {
      if (!busy)
        consoleApi<ConsoleOrder>('GET', path)
          .then(setOrder)
          .catch(() => {})
    }, 10_000)
    return () => clearInterval(t)
  }, [path, busy, order.status])

  const act = useCallback(
    async <T extends ConsoleOrder | { order: ConsoleOrder }>(
      fn: () => Promise<T>,
      ok?: string,
    ): Promise<T> => {
      setBusy(true)
      setMessage(null)
      try {
        const result = await fn()
        setOrder('order' in result ? result.order : result)
        if (ok) setMessage({ tone: 'ok', text: ok })
        return result
      } catch (err) {
        const e = err as ConsoleApiError
        setMessage({ tone: 'error', text: e.message })
        throw e
      } finally {
        setBusy(false)
      }
    },
    [],
  )
  /** Errors are already shown as the message: swallow them for fire-and-forget calls. */
  const quiet = (p: Promise<unknown>): Promise<void> =>
    p.then(
      () => undefined,
      () => undefined,
    )

  /** Turns an error into a question; the question replaces the error banner. */
  const ask = (message: string, yes: string, run: () => Promise<void>) => {
    setMessage(null)
    setPending({ kind: 'confirm', message, yes, run })
  }

  // ---- line actions
  function pick(line: Line, body: PickBody, confirmed = false) {
    return quiet(
      act(() =>
        consoleApi<{
          order: ConsoleOrder
          suggestOutOfStock: { productId: string; name: string } | null
        }>(
          'POST',
          `${path}/lines/${line.id}`,
          confirmed && body.action === 'picked' ? { ...body, confirmUnusualWeight: true } : body,
        ),
      )
        .then((r) => {
          setScanFor(null)
          const s = r.suggestOutOfStock
          if (s) setPending({ kind: 'outOfStock', productId: s.productId, name: s.name })
        })
        .catch((e: ConsoleApiError) => {
          if (e.code === 'WEIGHT_CONFIRMATION_REQUIRED')
            ask(e.message, 'Yes, the weight is right', () => pick(line, body, true))
          throw e
        }),
    )
  }

  function substitute(line: Line, body: SubBody, confirmed = false) {
    return quiet(
      act(() =>
        consoleApi<ConsoleOrder>(
          'POST',
          `${path}/lines/${line.id}/substitute`,
          confirmed ? { ...body, confirmUnusualWeight: true } : body,
        ),
      ).catch((e: ConsoleApiError) => {
        if (e.code === 'WEIGHT_CONFIRMATION_REQUIRED')
          ask(e.message, 'Yes, the weight is right', () => substitute(line, body, true))
        throw e
      }),
    )
  }

  async function onScan(scanned: string) {
    setMessage(null)
    let r: ScanResult
    try {
      r = await consoleApi<ScanResult>('POST', `${path}/scan`, { code: scanned })
    } catch (err) {
      setMessage({ tone: 'error', text: (err as Error).message })
      return
    }
    const line = order.lines.find((l) => l.id === r.lineId)
    if (r.match === 'line' && line) {
      if (line.status !== 'ordered')
        return setMessage({ tone: 'error', text: `${line.name} is already done. Undo it first.` })
      const hasLabel = r.priceCents !== null || r.weightLb !== null
      if (!line.isWeighed || hasLabel)
        return pick(line, {
          action: 'picked',
          ...(line.sellBy === 'weight' ? {} : { quantity: line.quantity ?? 1 }),
          scannedCode: scanned,
        })
      setScanFor({ lineId: line.id, code: scanned })
      setMessage({ tone: 'ok', text: `✓ ${line.name}: now enter the weight` })
      return
    }
    if (r.match === 'replacement' && line && r.productId)
      return setSubPreset({ line, productId: r.productId, code: scanned })
    if (r.match === 'not_in_order')
      return setMessage({
        tone: 'error',
        text: `Wrong item? That's ${r.name}, which isn't in this order.`,
      })
    if (r.match === 'unknown')
      return setMessage({
        tone: 'error',
        text: "We don't know this barcode. It has been reported.",
      })
    setMessage({ tone: 'error', text: "That barcode didn't read correctly. Scan it again." })
  }

  // ---- order actions
  const complete = (confirmOverAuthorization = false): Promise<void> =>
    quiet(
      act(
        () => consoleApi<ConsoleOrder>('POST', `${path}/complete`, { confirmOverAuthorization }),
        'Picking complete. Charging the final amount…',
      ).catch((e: ConsoleApiError) => {
        if (e.code === 'OVER_AUTHORIZATION')
          ask(`${e.message}`, 'Complete anyway', () => complete(true))
        throw e
      }),
    )

  const start = (takeover = false): Promise<void> =>
    quiet(
      act(() => consoleApi<ConsoleOrder>('POST', `${path}/start`, { takeover })).catch(
        (e: ConsoleApiError) => {
          if (e.code === 'PICKER_CONFLICT')
            ask('Another picker is working on this order. Take it over?', 'Take over', () =>
              start(true),
            )
          throw e
        },
      ),
    )

  const byCategory = new Map<string, Line[]>()
  for (const l of order.lines) {
    const key = l.category ?? 'Other'
    byCategory.set(key, [...(byCategory.get(key) ?? []), l])
  }
  const picking = order.status === 'picking' && order.pickedByMe
  const m = order.money

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-white p-4 shadow-sm">
        <div>
          <p className="text-2xl font-semibold">{order.statusLabel}</p>
          <p>
            For <strong>{order.pickupName}</strong>
            {order.pickupStartsAt &&
              ` · pickup ${storeTime(order.pickupStartsAt, timeZone)}–${storeTime(order.pickupEndsAt, timeZone)}`}
          </p>
          {order.arrivedAt && (
            <p className="mt-1 inline-block rounded bg-[#1F3A2E] px-2 py-0.5 text-sm text-white">
              Customer is here{order.arrivalNote ? `: ${order.arrivalNote}` : ''}
            </p>
          )}
          {order.status === 'picking' && !order.pickedByMe && (
            <p className="mt-1 text-sm">Being picked by staff #{order.pickerId}</p>
          )}
        </div>
        <dl className="text-right text-sm">
          <div>
            <dt className="inline">Estimated </dt>
            <dd className="inline font-medium">{money(m.estimatedTotalCents)}</dd>
          </div>
          <div>
            <dt className="inline">
              {m.finalTotalCents !== null ? 'Charged ' : 'If completed now '}
            </dt>
            <dd className="inline text-lg font-semibold">
              {money(m.finalTotalCents ?? m.projectedTotalCents)}
            </dd>
          </div>
          <div>
            <dt className="inline">Card hold </dt>
            <dd className="inline">{money(m.ceilingCents)}</dd>
          </div>
          {m.overCeilingCents > 0 && (
            <p className="mt-1 rounded bg-[#FFF4D6] px-2 text-[#8A5A00]">
              {money(m.overCeilingCents)} over the hold: reduce a weighed item
            </p>
          )}
        </dl>
      </section>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded px-4 py-2 ${message.tone === 'error' ? 'bg-[#B3261E] text-white' : 'bg-[#EEF3EC]'}`}
        >
          {message.text}
        </p>
      )}

      {pending?.kind === 'confirm' && (
        <div
          role="alertdialog"
          aria-label="Confirm"
          className="rounded-xl border-2 border-[#C9962C] bg-white p-4"
        >
          <p className="mb-3">{pending.message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-[#1F3A2E] px-4 py-2 text-white"
              onClick={() => {
                const run = pending.run
                setPending(null)
                run()
              }}
            >
              {pending.yes}
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={() => setPending(null)}
            >
              Go back
            </button>
          </div>
        </div>
      )}
      {pending?.kind === 'outOfStock' && (
        <div className="rounded-xl border border-neutral-300 bg-white p-4">
          <p className="mb-2">
            Hide <strong>{pending.name}</strong> from the store until the next opening?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-[#1F3A2E] px-4 py-2 text-white"
              onClick={async () => {
                const { productId, name } = pending
                setPending(null)
                try {
                  await consoleApi(
                    'PUT',
                    `locations/${locationId}/availability/products/${encodeURIComponent(productId)}`,
                    { outOfStock: true },
                  )
                  setMessage({ tone: 'ok', text: `${name} is hidden until the next opening.` })
                } catch (err) {
                  setMessage({ tone: 'error', text: (err as Error).message })
                }
              }}
            >
              Out of stock today
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={() => setPending(null)}
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* ---- status actions */}
      <section className="flex flex-wrap items-center gap-2">
        {order.status === 'placed' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                quiet(act(() => consoleApi<ConsoleOrder>('POST', `${path}/accept`), 'Accepted'))
              }
              className="rounded-lg bg-[#2E7D32] px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
            >
              Accept order
            </button>
            {pending?.kind === 'reject' ? (
              REJECT_REASONS.map(([reason, label]) => (
                <button
                  key={reason}
                  type="button"
                  disabled={busy}
                  className="rounded border border-[#B3261E] px-3 py-3 text-[#B3261E]"
                  onClick={() => {
                    setPending(null)
                    quiet(act(() => consoleApi<ConsoleOrder>('POST', `${path}/reject`, { reason })))
                  }}
                >
                  {label}
                </button>
              ))
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending({ kind: 'reject' })}
                className="rounded-lg border border-[#B3261E] px-6 py-3 text-[#B3261E]"
              >
                Reject…
              </button>
            )}
          </>
        )}
        {(order.status === 'accepted' || (order.status === 'picking' && !order.pickedByMe)) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => start()}
            className="rounded-lg bg-[#1F3A2E] px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
          >
            {order.status === 'accepted' ? 'Start picking' : 'Take over picking'}
          </button>
        )}
        {picking && (
          <button
            type="button"
            disabled={busy || order.unresolvedLines > 0}
            onClick={() => complete()}
            className="rounded-lg bg-[#2E7D32] px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
          >
            {order.unresolvedLines > 0
              ? `${order.unresolvedLines} item${order.unresolvedLines === 1 ? '' : 's'} left`
              : 'Complete picking'}
          </button>
        )}
        {order.status === 'picked' && <p>Charging the final amount. This takes a few seconds.</p>}
        {order.status === 'payment_issue' && (
          <p className="text-[#B3261E]">
            The payment could not be captured. Support has been alerted.
          </p>
        )}
        <Link
          href={`/console/orders/${order.publicId}/print`}
          target="_blank"
          className="ml-auto rounded border px-3 py-2 text-sm"
        >
          🖨 Pick slip &amp; labels
        </Link>
      </section>

      {(order.status === 'ready' || order.status === 'no_show') && (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold">Hand over</h2>
          {order.pickupLocked ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[#B3261E]">
                Locked after too many wrong codes. Check the customer&apos;s ID.
              </p>
              {order.role !== 'picker' && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border px-3 py-2"
                  onClick={() =>
                    quiet(act(() => consoleApi<ConsoleOrder>('POST', `${path}/unlock`), 'Unlocked'))
                  }
                >
                  Unlock (manager)
                </button>
              )}
            </div>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                quiet(
                  act(
                    () => consoleApi<ConsoleOrder>('POST', `${path}/handover`, { code }),
                    'Handed over ✓',
                  ),
                ).then(() => setCode(''))
              }}
            >
              <label>
                Pickup code from the customer
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="\d{6}"
                  required
                  className="ml-2 w-36 rounded border px-3 py-2 font-mono text-2xl tracking-widest"
                />
              </label>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="rounded-lg bg-[#1F3A2E] px-6 py-3 text-white disabled:opacity-50"
              >
                Hand over
              </button>
            </form>
          )}
        </section>
      )}

      {picking && <Scanner onScan={onScan} disabled={busy} />}
      {subPreset && (
        <SubstitutePanel
          publicId={order.publicId}
          line={subPreset.line}
          busy={busy}
          preset={{ productId: subPreset.productId, scannedCode: subPreset.code }}
          onCancel={() => setSubPreset(null)}
          onSubmit={(body) => {
            const line = subPreset.line
            setSubPreset(null)
            substitute(line, body)
          }}
        />
      )}

      {[...byCategory.entries()].map(([category, lines]) => (
        <section key={category} aria-label={category}>
          <h2 className="mb-2 font-semibold">{category}</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {lines.map((l) => (
              <LineCard
                key={l.id}
                publicId={order.publicId}
                line={l}
                editable={picking}
                busy={busy}
                pendingScan={scanFor?.lineId === l.id ? scanFor.code : null}
                onPick={(body) => pick(l, body)}
                onSubstitute={(body) => substitute(l, body)}
              />
            ))}
          </div>
        </section>
      ))}

      <details className="rounded-xl bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold">Timeline</summary>
        <ol className="mt-2 space-y-1 text-sm">
          {order.timeline.map((e, i) => (
            <li key={i}>
              {storeTime(e.at, timeZone)} · {e.label}
              {e.reason ? ` (${e.reason})` : ''} · {e.actorType}
            </li>
          ))}
        </ol>
      </details>
      <p className="sr-only">Signed in as staff #{me}</p>
    </main>
  )
}
