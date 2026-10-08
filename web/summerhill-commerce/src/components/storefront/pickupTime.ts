
export interface PickupSlot {
  id: number
  startsAt: string
  endsAt: string
  remaining: number
}

const dayFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'short', month: 'short', day: 'numeric' })
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', minute: '2-digit' })
const dateKeyFormat = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone })

export function formatPickupDay(iso: string | Date, timeZone: string): string {
  return dayFormat(timeZone).format(new Date(iso))
}

export function formatPickupRange(
  startsAt: string | Date,
  endsAt: string | Date,
  timeZone: string,
): string {
  const t = timeFormat(timeZone)
  return `${t.format(new Date(startsAt))} – ${t.format(new Date(endsAt))}`
}

export function formatPickupWindow(
  startsAt: string | Date,
  endsAt: string | Date,
  timeZone: string,
): string {
  return `${formatPickupDay(startsAt, timeZone)}, ${formatPickupRange(startsAt, endsAt, timeZone)}`
}

export function groupSlotsByDay<S extends { startsAt: string }>(
  slots: S[],
  timeZone: string,
): Array<{ key: string; label: string; slots: S[] }> {
  const groups = new Map<string, { key: string; label: string; slots: S[] }>()
  for (const s of slots) {
    const key = dateKeyFormat(timeZone).format(new Date(s.startsAt))
    if (!groups.has(key))
      groups.set(key, { key, label: formatPickupDay(s.startsAt, timeZone), slots: [] })
    groups.get(key)!.slots.push(s)
  }
  return [...groups.values()]
}
