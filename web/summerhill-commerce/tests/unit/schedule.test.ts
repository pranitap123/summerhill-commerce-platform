import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WEEKLY_HOURS,
  isoWeekday,
  nextOpening,
  plannedSlots,
  slotRejection,
  weeklyHoursSchema,
  type ScheduleSettings,
} from '@/modules/scheduling'
import { toWallClock } from '@/server/time'

/** G4-01 / G4-03: slot planning, offer rules and DST (ORDERS §3). Pure; no database. */
const TZ = 'America/Toronto'
const settings = (over: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  slotMinutes: 60,
  slotCapacity: 5,
  leadTimeMinutes: 120,
  timeZone: TZ,
  ...over,
})
const wall = (d: Date) => toWallClock(d, TZ)
const everyDay = (open: string, close: string) =>
  Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open, close }]))

describe('weekday and hours', () => {
  it('ISO weekdays: 1 Nov 2026 is a Sunday, 14 Mar 2027 a Sunday, 2 Nov 2026 a Monday', () => {
    expect(isoWeekday({ year: 2026, month: 11, day: 1 })).toBe(7)
    expect(isoWeekday({ year: 2027, month: 3, day: 14 })).toBe(7)
    expect(isoWeekday({ year: 2026, month: 11, day: 2 })).toBe(1)
  })

  it('validates opening hours', () => {
    expect(weeklyHoursSchema.safeParse({ '1': { open: '08:00', close: '21:00' } }).success).toBe(
      true,
    )
    expect(weeklyHoursSchema.safeParse({ '1': { open: '21:00', close: '08:00' } }).success).toBe(
      false,
    )
    expect(weeklyHoursSchema.safeParse({ '1': { open: '8am', close: '21:00' } }).success).toBe(
      false,
    )
    expect(weeklyHoursSchema.safeParse({ '8': null }).success).toBe(false)
    expect(weeklyHoursSchema.safeParse({ '7': null }).success).toBe(true)
    expect(weeklyHoursSchema.safeParse({ '1': { open: '22:00', close: '24:00' } }).success).toBe(
      true,
    )
  })
})

describe('plannedSlots', () => {
  it('a week of default hours: 13 weekday slots, 11 on Saturday, 8 on Sunday', () => {
    // Monday 2 Nov 2026, 00:00 local
    const slots = plannedSlots(settings(), new Set(), new Date('2026-11-02T05:00:00Z'), 7)
    expect(slots).toHaveLength(13 * 5 + 11 + 8)
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(slots.length)
  })

  it('holiday closures and closed weekdays produce no slots', () => {
    const closed = settings({ weeklyHours: { ...DEFAULT_WEEKLY_HOURS, '7': null } })
    const slots = plannedSlots(closed, new Set(['2026-11-03']), new Date('2026-11-02T05:00:00Z'), 7)
    expect(slots.some((s) => wall(s.startsAt).day === 3)).toBe(false) // closure (Tuesday)
    expect(slots.some((s) => wall(s.startsAt).day === 8)).toBe(false) // Sunday closed
    expect(slots).toHaveLength(13 * 4 + 11)
  })

  it.each([
    ['fall back, Sun 1 Nov 2026', '2026-11-01T04:00:00Z', 1],
    ['spring forward, Sun 14 Mar 2027', '2027-03-14T05:00:00Z', 14],
  ])('%s: store hours produce no duplicate or missing slots', (_, from, day) => {
    const slots = plannedSlots(settings(), new Set(), new Date(from), 1)
    expect(slots.map((s) => wall(s.startsAt).hour)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    expect(slots.every((s) => wall(s.startsAt).day === day)).toBe(true)
    for (let i = 1; i < slots.length; i++)
      expect(slots[i].startsAt.getTime()).toBe(slots[i - 1].endsAt.getTime())
    // Each slot lasts exactly one real hour (the DST change happens at 02:00, before opening)
    expect(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 3_600_000)).toBe(true)
  })

  it('a 24-hour store on DST days: fall back keeps 24 unique slots, spring forward has 23', () => {
    const allDay = settings({ weeklyHours: everyDay('00:00', '24:00') })
    const fall = plannedSlots(allDay, new Set(), new Date('2026-11-01T04:00:00Z'), 1)
    expect(fall).toHaveLength(24)
    expect(new Set(fall.map((s) => s.startsAt.getTime())).size).toBe(24)
    const spring = plannedSlots(allDay, new Set(), new Date('2027-03-14T05:00:00Z'), 1)
    expect(spring).toHaveLength(23) // 02:00 doesn't exist that day
    expect(spring.map((s) => wall(s.startsAt).hour)).not.toContain(2)
    expect(new Set(spring.map((s) => s.startsAt.getTime())).size).toBe(23)
  })

  it('30-minute slots', () => {
    const half = settings({ slotMinutes: 30 })
    expect(plannedSlots(half, new Set(), new Date('2026-11-02T05:00:00Z'), 1)).toHaveLength(26)
  })
})

describe('slotRejection (what a cart may book)', () => {
  const now = new Date('2026-11-02T14:00:00Z') // Monday 09:00 EST
  const ctx = { now, leadTimeMinutes: 120, timeZone: TZ, itemAvailableDays: [] as number[][] }
  const at = (iso: string) => ({ startsAt: new Date(iso) })

  it('respects the lead time', () => {
    expect(slotRejection(at('2026-11-02T15:00:00Z'), ctx)).toBe('past_lead_time') // 10:00
    expect(slotRejection(at('2026-11-02T16:00:00Z'), ctx)).toBeNull() // 11:00 = now + 2 h
  })

  it('offers at most 5 days ahead (authorisations expire after ~7)', () => {
    expect(slotRejection(at('2026-11-07T14:00:00Z'), ctx)).toBeNull()
    expect(slotRejection(at('2026-11-07T15:00:00Z'), ctx)).toBe('beyond_window')
  })

  it("respects every item's available days (weekday in the store's time zone)", () => {
    const weekdaysOnly = { ...ctx, itemAvailableDays: [[], [1, 2, 3, 4, 5]] }
    expect(slotRejection(at('2026-11-06T16:00:00Z'), weekdaysOnly)).toBeNull() // Friday
    expect(
      slotRejection(at('2026-11-07T15:00:00Z'), {
        ...weekdaysOnly,
        now: new Date('2026-11-03T14:00:00Z'),
      }),
    ).toBe('item_not_available_that_day') // Saturday
    // Sunday 00:30 local is still Saturday in UTC terms; the store's calendar decides
    expect(
      slotRejection(at('2026-11-08T05:30:00Z'), {
        ...ctx,
        now: new Date('2026-11-04T14:00:00Z'),
        itemAvailableDays: [[7]],
      }),
    ).toBeNull()
  })
})

describe('nextOpening ("out of stock today" lasts until the store next opens)', () => {
  it('during opening hours: tomorrow morning', () => {
    const at = nextOpening(settings(), new Set(), new Date('2026-11-02T16:00:00Z')) // Mon 11:00
    expect(at?.toISOString()).toBe('2026-11-03T13:00:00.000Z') // Tue 08:00 EST
  })
  it('before opening: this morning', () => {
    const at = nextOpening(settings(), new Set(), new Date('2026-11-02T11:00:00Z')) // Mon 06:00
    expect(at?.toISOString()).toBe('2026-11-02T13:00:00.000Z')
  })
  it('skips holiday closures', () => {
    const at = nextOpening(settings(), new Set(['2026-11-03']), new Date('2026-11-02T16:00:00Z'))
    expect(at?.toISOString()).toBe('2026-11-04T13:00:00.000Z')
  })
  it('is null for a store with no opening hours', () => {
    expect(nextOpening(settings({ weeklyHours: {} }), new Set(), new Date())).toBeNull()
  })
})
