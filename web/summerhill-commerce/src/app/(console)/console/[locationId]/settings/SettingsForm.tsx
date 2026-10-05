'use client'

import { useEffect, useState } from 'react'

import { consoleApi, storeTime } from '../../_lib/api'

type Hours = Record<string, { open: string; close: string } | null>
interface Settings {
  weeklyHours: Hours
  slotMinutes: number
  slotCapacity: number
  leadTimeMinutes: number
  paused: boolean
  pauseReason: string | null
  scaleBarcode: {
    itemDigits: number
    valueDigits: number
    priceCheckDigit: boolean
    value: 'price' | 'weight'
    weightDecimals?: 2 | 3
  }
  updatedBy: string | null
  updatedAt: string | null
}
interface View {
  settings: Settings
  closures: Array<{ date: string; reason: string }>
  slots: Array<{
    id: number
    startsAt: string
    endsAt: string
    capacity: number
    booked: number
    held: number
    closed: boolean
  }>
}

const DAYS: Array<[string, string]> = [
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
  ['7', 'Sunday'],
]

/**
 * Store settings (G4-01, M10/M13): opening hours, slot length and capacity, lead time, holiday
 * closures, pause, and the scale-label layout. Saving is audited and changes future slots only;
 * slots with bookings keep them.
 */
export function SettingsForm({
  locationId,
  canEdit,
  timeZone,
}: {
  locationId: number
  canEdit: boolean
  timeZone: string
}) {
  const [view, setView] = useState<View | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [closure, setClosure] = useState({ date: '', reason: '' })
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `locations/${locationId}`

  useEffect(() => {
    let live = true
    consoleApi<View>('GET', `${base}/settings`)
      .then((v) => {
        if (!live) return
        setView(v)
        setDraft(v.settings)
      })
      .catch((e: Error) => live && setMessage({ tone: 'error', text: e.message }))
    return () => {
      live = false
    }
  }, [base])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      const v = await consoleApi<View>('GET', `${base}/settings`)
      setView(v)
      setDraft(v.settings)
      setMessage({ tone: 'ok', text: ok })
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!view || !draft)
    return <main className="p-6">{message ? <p role="alert">{message.text}</p> : 'Loading…'}</main>
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch })
  const setDay = (day: string, value: { open: string; close: string } | null) =>
    set({ weeklyHours: { ...draft.weeklyHours, [day]: value } })

  const byDay = new Map<string, View['slots']>()
  for (const s of view.slots) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(s.startsAt))
    byDay.set(key, [...(byDay.get(key) ?? []), s])
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4">
      {!canEdit && (
        <p className="rounded bg-[#FFF4D6] px-4 py-2">
          Only the store owner can change these settings.
        </p>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded px-4 py-2 ${message.tone === 'error' ? 'bg-[#B3261E] text-white' : 'bg-[#EEF3EC]'}`}
        >
          {message.text}
        </p>
      )}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          run(
            () =>
              consoleApi('PUT', `${base}/settings`, {
                weeklyHours: draft.weeklyHours,
                slotMinutes: draft.slotMinutes,
                slotCapacity: draft.slotCapacity,
                leadTimeMinutes: draft.leadTimeMinutes,
                paused: draft.paused,
                pauseReason: draft.pauseReason?.trim() || null,
                scaleBarcode: draft.scaleBarcode,
              }),
            'Saved. Future slots were updated.',
          )
        }}
      >
        <fieldset disabled={!canEdit || busy} className="space-y-6">
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">Taking orders</h2>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.paused}
                onChange={(e) => set({ paused: e.target.checked })}
              />
              Pause new orders (placed orders still need handling)
            </label>
            {draft.paused && (
              <input
                aria-label="Reason for pausing"
                placeholder="Reason (shown to staff)"
                value={draft.pauseReason ?? ''}
                maxLength={200}
                onChange={(e) => set({ pauseReason: e.target.value })}
                className="mt-2 w-full rounded border px-3 py-2"
              />
            )}
          </section>

          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">Opening hours ({timeZone})</h2>
            <table className="text-sm">
              <tbody>
                {DAYS.map(([day, label]) => {
                  const hours = draft.weeklyHours[day] ?? null
                  return (
                    <tr key={day}>
                      <th scope="row" className="pr-4 text-left font-medium">
                        {label}
                      </th>
                      <td className="pr-4">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={!hours}
                            onChange={(e) =>
                              setDay(
                                day,
                                e.target.checked ? null : { open: '09:00', close: '18:00' },
                              )
                            }
                          />
                          Closed
                        </label>
                      </td>
                      {hours && (
                        <td className="flex items-center gap-1 py-1">
                          <input
                            type="time"
                            aria-label={`${label} opens`}
                            value={hours.open}
                            onChange={(e) => setDay(day, { ...hours, open: e.target.value })}
                            className="rounded border px-2 py-1"
                          />
                          –
                          <input
                            type="time"
                            aria-label={`${label} closes`}
                            value={hours.close}
                            onChange={(e) => setDay(day, { ...hours, close: e.target.value })}
                            className="rounded border px-2 py-1"
                          />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <section className="grid gap-4 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-3">
            <label className="text-sm">
              Slot length
              <select
                value={draft.slotMinutes}
                onChange={(e) => set({ slotMinutes: Number(e.target.value) })}
                className="mt-1 block w-full rounded border bg-white px-2 py-2"
              >
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Orders per slot
              <input
                type="number"
                min={1}
                max={100}
                value={draft.slotCapacity}
                onChange={(e) => set({ slotCapacity: Number(e.target.value) })}
                className="mt-1 block w-full rounded border px-2 py-2"
              />
            </label>
            <label className="text-sm">
              Lead time (minutes)
              <input
                type="number"
                min={0}
                max={10080}
                step={15}
                value={draft.leadTimeMinutes}
                onChange={(e) => set({ leadTimeMinutes: Number(e.target.value) })}
                className="mt-1 block w-full rounded border px-2 py-2"
              />
            </label>
          </section>

          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">Scale labels (deli, meat, cheese)</h2>
            <p className="mb-2 text-sm text-neutral-600">
              How your scales print GS1 variable-measure barcodes: 2 · item code · value · check
              digit.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                Item code digits{' '}
                <select
                  value={draft.scaleBarcode.itemDigits}
                  onChange={(e) =>
                    set({
                      scaleBarcode: { ...draft.scaleBarcode, itemDigits: Number(e.target.value) },
                    })
                  }
                  className="rounded border bg-white px-2 py-1"
                >
                  {[4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                Value digits{' '}
                <select
                  value={draft.scaleBarcode.valueDigits}
                  onChange={(e) =>
                    set({
                      scaleBarcode: { ...draft.scaleBarcode, valueDigits: Number(e.target.value) },
                    })
                  }
                  className="rounded border bg-white px-2 py-1"
                >
                  {[4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.scaleBarcode.priceCheckDigit}
                  onChange={(e) =>
                    set({
                      scaleBarcode: { ...draft.scaleBarcode, priceCheckDigit: e.target.checked },
                    })
                  }
                />
                Price check digit
              </label>
              <label>
                Value is{' '}
                <select
                  value={draft.scaleBarcode.value}
                  onChange={(e) =>
                    set({
                      scaleBarcode: {
                        ...draft.scaleBarcode,
                        value: e.target.value as 'price' | 'weight',
                        ...(e.target.value === 'weight' ? { weightDecimals: 2 } : {}),
                      },
                    })
                  }
                  className="rounded border bg-white px-2 py-1"
                >
                  <option value="price">the price (cents)</option>
                  <option value="weight">the weight (lb)</option>
                </select>
              </label>
            </div>
          </section>

          {canEdit && (
            <button
              type="submit"
              className="rounded-lg bg-[#1F3A2E] px-6 py-3 text-white disabled:opacity-50"
            >
              Save settings
            </button>
          )}
          {draft.updatedBy && (
            <p className="text-xs text-neutral-600">
              Last changed by {draft.updatedBy}
              {draft.updatedAt
                ? ` at ${new Date(draft.updatedAt).toLocaleString('en-CA', { timeZone })}`
                : ''}
            </p>
          )}
        </fieldset>
      </form>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Holiday closures</h2>
        {view.closures.length === 0 && <p className="text-sm">None coming up.</p>}
        <ul className="mb-3 space-y-1 text-sm">
          {view.closures.map((c) => (
            <li key={c.date} className="flex items-center gap-3">
              <span className="font-mono">{c.date}</span> {c.reason}
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() =>
                    run(() => consoleApi('DELETE', `${base}/closures/${c.date}`), 'Closure removed')
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="flex flex-wrap items-end gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => consoleApi('POST', `${base}/closures`, closure), 'Closure added').then(() =>
                setClosure({ date: '', reason: '' }),
              )
            }}
          >
            <label>
              Date{' '}
              <input
                type="date"
                required
                value={closure.date}
                onChange={(e) => setClosure({ ...closure, date: e.target.value })}
                className="rounded border px-2 py-1"
              />
            </label>
            <label>
              Reason{' '}
              <input
                required
                maxLength={100}
                placeholder="e.g. Christmas Day"
                value={closure.reason}
                onChange={(e) => setClosure({ ...closure, reason: e.target.value })}
                className="rounded border px-2 py-1"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-[#1F3A2E] px-3 py-1 text-white"
            >
              Add closure
            </button>
          </form>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Slots, next 7 days</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[...byDay.entries()].map(([day, slots]) => (
            <div key={day}>
              <h3 className="font-medium">{day}</h3>
              <ul className="text-sm">
                {slots.map((s) => (
                  <li key={s.id} className={s.closed ? 'text-neutral-400 line-through' : ''}>
                    {storeTime(s.startsAt, timeZone)} · {s.booked} booked
                    {s.held ? `, ${s.held} in checkout` : ''} of {s.capacity}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
