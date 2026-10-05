/**
 * Business time (G1-12). Store instants in UTC; interpret "store hours" and slot times in the
 * location's time zone (America/Toronto by default). Uses only Intl, no extra dependencies.
 *
 * DST policy for wall-clock times that don't map to exactly one instant:
 *  - nonexistent (spring forward, e.g. 02:30 on 14 Mar 2027 in Toronto): moved forward by the gap
 *  - ambiguous  (fall back, e.g. 01:30 on 1 Nov 2026 in Toronto): the earlier instant (daylight time)
 */
export const DEFAULT_TIME_ZONE = 'America/Toronto'

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

export interface WallClock {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

/** The wall-clock time in `timeZone` at the given instant. */
export function toWallClock(
  instant: Date,
  timeZone = DEFAULT_TIME_ZONE,
): WallClock & { second: number } {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Toronto: -300 in winter, -240 in summer). */
export function offsetMinutes(instant: Date, timeZone = DEFAULT_TIME_ZONE): number {
  const w = toWallClock(instant, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000)
}

/** Converts a wall-clock time in `timeZone` to a UTC instant, applying the DST policy above. */
export function fromWallClock(w: WallClock, timeZone = DEFAULT_TIME_ZONE): Date {
  const naiveUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  // Candidate instants using the offsets in force a day either side of the requested time.
  const offsets = new Set([
    offsetMinutes(new Date(naiveUtc - 36e5 * 26), timeZone),
    offsetMinutes(new Date(naiveUtc + 36e5 * 26), timeZone),
  ])
  const matches = [...offsets]
    .map((off) => new Date(naiveUtc - off * 60_000))
    .filter((d) => {
      const back = toWallClock(d, timeZone)
      return (
        back.year === w.year &&
        back.month === w.month &&
        back.day === w.day &&
        back.hour === w.hour &&
        back.minute === w.minute
      )
    })
    .sort((a, b) => a.getTime() - b.getTime())
  if (matches.length) return matches[0] // ambiguous → earlier instant
  // Nonexistent (inside a spring-forward gap): interpret it with the offset in force *before* the
  // gap. That instant reads as the same time plus the gap length after the change, e.g. 02:30 →
  // 03:30 in Toronto on 14 Mar 2027 ("moved forward by the gap").
  const offsetBefore = offsetMinutes(new Date(naiveUtc - 36e5 * 26), timeZone)
  return new Date(naiveUtc - offsetBefore * 60_000)
}

export interface Slot {
  startsAt: Date
  endsAt: Date
}

/**
 * Pickup slots for one local day, e.g. open 08:00, close 21:00, 60-minute slots → 13 slots.
 * Slots are built from wall-clock times, so a DST change never duplicates or drops a slot.
 */
export function slotsForLocalDay(
  date: { year: number; month: number; day: number },
  open: { hour: number; minute: number },
  close: { hour: number; minute: number },
  slotMinutes: number,
  timeZone = DEFAULT_TIME_ZONE,
): Slot[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0)
    throw new Error('slotMinutes must be a positive integer')
  const openMin = open.hour * 60 + open.minute
  const closeMin = close.hour * 60 + close.minute
  const slots: Slot[] = []
  for (let m = openMin; m + slotMinutes <= closeMin; m += slotMinutes) {
    const wall = { ...date, hour: Math.floor(m / 60), minute: m % 60 }
    const startsAt = fromWallClock(wall, timeZone)
    // A start time inside a spring-forward gap doesn't exist on this day: skip the slot rather
    // than let it collapse onto the next slot's start (which would create a duplicate).
    const back = toWallClock(startsAt, timeZone)
    if (back.hour !== wall.hour || back.minute !== wall.minute) continue
    const endMin = m + slotMinutes
    const endsAt = fromWallClock(
      { ...date, hour: Math.floor(endMin / 60), minute: endMin % 60 },
      timeZone,
    )
    slots.push({ startsAt, endsAt })
  }
  return slots
}
