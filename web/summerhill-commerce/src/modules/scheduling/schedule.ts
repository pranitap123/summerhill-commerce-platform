import { z } from 'zod'

import {
  DEFAULT_TIME_ZONE,
  fromWallClock,
  slotsForLocalDay,
  toWallClock,
  type Slot,
} from '@/server/time'

export const ISO_WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number]

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24-hour)')

export const dayHoursSchema = z
  .object({ open: hhmm, close: hhmm })
  .strict()
  .refine((h) => minutesOf(h.open) < minutesOf(h.close), {
    message: 'Closing time must be after opening time',
  })
  .refine((h) => h.open !== '24:00', { message: 'Opening time must be before 24:00' })
export type DayHours = z.infer<typeof dayHoursSchema>

export const weeklyHoursSchema = z
  .object(Object.fromEntries(ISO_WEEKDAYS.map((d) => [d, dayHoursSchema.nullable().optional()])))
  .strict()
export type WeeklyHours = Partial<Record<IsoWeekday, DayHours | null>>

export const SLOT_MINUTES = [15, 30, 45, 60, 90, 120] as const

export const BOOKING_WINDOW_DAYS = 5

export const GENERATION_DAYS = 7

export interface ScheduleSettings {
  weeklyHours: WeeklyHours
  slotMinutes: number
  slotCapacity: number
  leadTimeMinutes: number
  timeZone: string
}

export interface LocalDate {
  year: number
  month: number
  day: number
}

export function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

export const dateKey = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

export function parseDateKey(key: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) throw new Error(`invalid date ${key}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function isoWeekday(d: LocalDate): number {
  const js = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
  return js === 0 ? 7 : js
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function localDate(instant: Date, timeZone = DEFAULT_TIME_ZONE): LocalDate {
  const w = toWallClock(instant, timeZone)
  return { year: w.year, month: w.month, day: w.day }
}

export function hoursOn(
  date: LocalDate,
  settings: Pick<ScheduleSettings, 'weeklyHours'>,
  closures: ReadonlySet<string>,
): DayHours | null {
  if (closures.has(dateKey(date))) return null
  return settings.weeklyHours[String(isoWeekday(date)) as IsoWeekday] ?? null
}

export function plannedSlots(
  settings: ScheduleSettings,
  closures: ReadonlySet<string>,
  from: Date,
  days: number,
): Slot[] {
  const first = localDate(from, settings.timeZone)
  const slots: Slot[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i)
    const hours = hoursOn(date, settings, closures)
    if (!hours) continue
    const open = minutesOf(hours.open)
    const close = minutesOf(hours.close)
    slots.push(
      ...slotsForLocalDay(
        date,
        { hour: Math.floor(open / 60), minute: open % 60 },
        { hour: Math.floor(close / 60), minute: close % 60 },
        settings.slotMinutes,
        settings.timeZone,
      ),
    )
  }
  return slots
}

export interface OfferContext {
  now: Date
  leadTimeMinutes: number
  timeZone: string

  itemAvailableDays: ReadonlyArray<readonly number[]>
}

export type SlotRejection = 'past_lead_time' | 'beyond_window' | 'item_not_available_that_day'

export function slotRejection(
  slot: Pick<Slot, 'startsAt'>,
  ctx: OfferContext,
): SlotRejection | null {
  const start = slot.startsAt.getTime()
  if (start < ctx.now.getTime() + ctx.leadTimeMinutes * 60_000) return 'past_lead_time'
  if (start > ctx.now.getTime() + BOOKING_WINDOW_DAYS * 86_400_000) return 'beyond_window'
  const weekday = isoWeekday(localDate(slot.startsAt, ctx.timeZone))
  if (ctx.itemAvailableDays.some((days) => days.length > 0 && !days.includes(weekday)))
    return 'item_not_available_that_day'
  return null
}

export function nextOpening(
  settings: Pick<ScheduleSettings, 'weeklyHours' | 'timeZone'>,
  closures: ReadonlySet<string>,
  now: Date,
): Date | null {
  const today = localDate(now, settings.timeZone)
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today, i)
    const hours = hoursOn(date, settings, closures)
    if (!hours) continue
    const open = minutesOf(hours.open)
    const at = fromWallClock(
      { ...date, hour: Math.floor(open / 60), minute: open % 60 },
      settings.timeZone,
    )
    if (at.getTime() > now.getTime()) return at
  }
  return null
}

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  '1': { open: '08:00', close: '21:00' },
  '2': { open: '08:00', close: '21:00' },
  '3': { open: '08:00', close: '21:00' },
  '4': { open: '08:00', close: '21:00' },
  '5': { open: '08:00', close: '21:00' },
  '6': { open: '09:00', close: '20:00' },
  '7': { open: '10:00', close: '18:00' },
}
