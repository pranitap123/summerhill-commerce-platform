'use client'

import { useState } from 'react'

import { formatPickupRange, groupSlotsByDay, type PickupSlot } from './pickupTime'

export function SlotPicker({
  slots,
  timeZone,
  value,
  onChange,
  disabled,
}: {
  slots: PickupSlot[]
  timeZone: string
  value: number | null
  onChange(id: number): void
  disabled?: boolean
}) {
  const days = groupSlotsByDay(slots, timeZone)
  const selectedDay = days.find((d) => d.slots.some((s) => s.id === value))?.key
  const [day, setDay] = useState<string | null>(null)
  const current = days.find((d) => d.key === (day ?? selectedDay)) ?? days[0]
  if (!current) return null

  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Pickup time</legend>
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Pickup day">
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={d.key === current.key}
            onClick={() => setDay(d.key)}
            className={`rounded-full border px-3 py-1 text-sm whitespace-nowrap ${
              d.key === current.key
                ? 'border-[#1F3A2E] bg-[#1F3A2E] text-white'
                : 'border-neutral-300 bg-white'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div
        className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto"
        role="radiogroup"
        aria-label="Pickup window"
      >
        {current.slots.map((s) => (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${
              s.id === value ? 'border-[#1F3A2E] bg-[#EEF3EC]' : 'border-neutral-300 bg-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="pickup-slot"
                value={s.id}
                checked={s.id === value}
                onChange={() => onChange(s.id)}
              />
              {formatPickupRange(s.startsAt, s.endsAt, timeZone)}
            </span>
            {s.remaining <= 2 && <span className="text-xs text-[#B3261E]">{s.remaining} left</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
