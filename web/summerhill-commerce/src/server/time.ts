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
  month: number
  day: number
  hour: number
  minute: number
}

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

export function offsetMinutes(instant: Date, timeZone = DEFAULT_TIME_ZONE): number {
  const w = toWallClock(instant, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000)
}

export function fromWallClock(w: WallClock, timeZone = DEFAULT_TIME_ZONE): Date {
  const naiveUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)

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
  if (matches.length) return matches[0]

  const offsetBefore = offsetMinutes(new Date(naiveUtc - 36e5 * 26), timeZone)
  return new Date(naiveUtc - offsetBefore * 60_000)
}

export interface Slot {
  startsAt: Date
  endsAt: Date
}

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
