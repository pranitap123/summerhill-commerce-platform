'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { consoleApi, storeTime } from '../_lib/api'

interface QueueOrder {
  publicId: string
  status: string
  statusLabel: string
  pickupName: string
  pickupStartsAt: string | null
  pickupEndsAt: string | null
  placedAt: string | null
  autoRejectAt: string | null
  itemCount: number
  weighedCount: number
  cold: boolean
  arrivedAt: string | null
  arrivalNote: string | null
  pickedByMe: boolean
  pickerId: string | null
  pickupLocked: boolean
}

interface QueueData {
  location: { id: number; name: string; paused: boolean; pauseReason: string | null }
  serverTime: string
  orders: QueueOrder[]
  done: QueueOrder[]
}

export const POLL_MS = 10_000

const COLUMNS: Array<{ title: string; statuses: string[]; empty: string }> = [
  { title: 'New', statuses: ['placed'], empty: 'No new orders' },
  { title: 'To pick', statuses: ['accepted'], empty: 'Nothing waiting' },
  { title: 'Picking', statuses: ['picking', 'picked', 'payment_issue'], empty: 'Nobody picking' },
  { title: 'Ready for pickup', statuses: ['ready', 'no_show'], empty: 'Nothing ready' },
]

function chime() {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(ctx.currentTime + i * 0.18)
    osc.stop(ctx.currentTime + i * 0.18 + 0.4)
  })
  setTimeout(() => ctx.close(), 1000)
}

export function Queue({ locationId, timeZone }: { locationId: number; timeZone: string }) {
  const [data, setData] = useState<QueueData | null>(null)
  const [lastOk, setLastOk] = useState<Date | null>(null)
  const [offline, setOffline] = useState(false)
  const [sound, setSound] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<Set<string> | null>(null)

  const soundRef = useRef(false)

  useEffect(() => {
    let live = true
    let inFlight = false

    const load = () => {
      if (inFlight) return
      inFlight = true
      return consoleApi<QueueData>('GET', `locations/${locationId}/queue`)
        .then((d) => {
          if (!live) return
          const fresh = d.orders.filter((o) => o.status === 'placed').map((o) => o.publicId)
          if (seen.current && fresh.some((id) => !seen.current!.has(id)) && soundRef.current)
            chime()
          seen.current = new Set([...(seen.current ?? []), ...fresh])
          setData(d)
          setLastOk(new Date())
          setOffline(false)
        })
        .catch(() => live && setOffline(true))
        .finally(() => {
          inFlight = false
        })
    }
    load()
    const poll = setInterval(load, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const online = () => load()
    const offlineEvt = () => setOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', offlineEvt)
    document.addEventListener('visibilitychange', online)
    return () => {
      live = false
      clearInterval(poll)
      clearInterval(tick)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offlineEvt)
      document.removeEventListener('visibilitychange', online)
    }
  }, [locationId])

  return (
    <main className="p-4">
      {offline && (
        <p role="alert" className="mb-3 rounded bg-[#B3261E] px-4 py-2 text-white">
          Offline. Showing the list from {lastOk ? storeTime(lastOk.toISOString(), timeZone) : '–'}.
          New orders will appear when the connection is back.
        </p>
      )}
      {data?.location.paused && (
        <p className="mb-3 rounded bg-[#FFF4D6] px-4 py-2">
          <strong>Paused:</strong> the store is not taking new orders
          {data.location.pauseReason ? ` (${data.location.pauseReason})` : ''}.{' '}
          <Link href={`/console/${locationId}/settings`} className="underline">
            Settings
          </Link>
        </p>
      )}
      <div className="mb-3 flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => {
            soundRef.current = !sound
            setSound(!sound)
            if (!sound) chime()
          }}
          aria-pressed={sound}
          className="rounded border border-neutral-400 bg-white px-3 py-1"
        >
          {sound ? '🔔 Sound on' : '🔕 Turn sound on'}
        </button>
        <span className="text-neutral-600" aria-live="polite">
          {lastOk ? `Updated ${storeTime(lastOk.toISOString(), timeZone)}` : 'Loading…'}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const orders = data?.orders.filter((o) => col.statuses.includes(o.status)) ?? []
          return (
            <section key={col.title} aria-label={col.title} className="min-w-0">
              <h2 className="mb-2 font-semibold">
                {col.title} <span className="text-neutral-500">({orders.length})</span>
              </h2>
              {orders.length === 0 && <p className="text-sm text-neutral-500">{col.empty}</p>}
              <ul className="space-y-2">
                {orders.map((o) => (
                  <li key={o.publicId}>
                    <OrderCard order={o} timeZone={timeZone} now={now} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {!!data?.done.length && (
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold">
            Done today ({data.done.length})
          </summary>
          <ul className="mt-2 grid gap-2 md:grid-cols-3">
            {data.done.map((o) => (
              <li key={o.publicId}>
                <Link
                  href={`/console/orders/${o.publicId}`}
                  className="block rounded bg-white px-3 py-2 text-sm shadow-sm"
                >
                  {o.publicId} · {o.pickupName} · {o.statusLabel}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  )
}

function OrderCard({
  order: o,
  timeZone,
  now,
}: {
  order: QueueOrder
  timeZone: string
  now: number
}) {
  const left = o.autoRejectAt ? Math.max(0, new Date(o.autoRejectAt).getTime() - now) : null
  const urgent = left !== null && left < 5 * 60_000
  return (
    <Link
      href={`/console/orders/${o.publicId}`}
      className={`block rounded-xl border-2 bg-white p-3 shadow-sm hover:shadow ${
        o.status === 'placed'
          ? 'border-[#C9962C]'
          : o.arrivedAt
            ? 'border-[#1F3A2E]'
            : 'border-transparent'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-lg font-semibold">{o.publicId}</span>
        <span className="text-xs text-neutral-600">{o.statusLabel}</span>
      </span>
      <span className="block">{o.pickupName}</span>
      {o.pickupStartsAt && (
        <span className="block text-sm">
          Pickup {storeTime(o.pickupStartsAt, timeZone)}–{storeTime(o.pickupEndsAt, timeZone)}
        </span>
      )}
      <span className="mt-1 flex flex-wrap gap-1 text-xs">
        <span className="rounded bg-neutral-100 px-2 py-0.5">
          {o.itemCount} items{o.weighedCount ? ` · ${o.weighedCount} weighed` : ''}
        </span>
        {o.cold && <span className="rounded bg-[#DCEBF7] px-2 py-0.5">❄ cold items</span>}
        {o.pickedByMe && <span className="rounded bg-[#EEF3EC] px-2 py-0.5">you are picking</span>}
        {o.pickupLocked && (
          <span className="rounded bg-[#B3261E] px-2 py-0.5 text-white">handover locked</span>
        )}
        {o.arrivedAt && (
          <span className="rounded bg-[#1F3A2E] px-2 py-0.5 text-white">
            here{o.arrivalNote ? `: ${o.arrivalNote}` : ''}
          </span>
        )}
      </span>
      {left !== null && (
        <span className={`mt-1 block text-sm ${urgent ? 'font-semibold text-[#B3261E]' : ''}`}>
          Accept within {Math.floor(left / 60_000)}:
          {String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}
        </span>
      )}
    </Link>
  )
}
