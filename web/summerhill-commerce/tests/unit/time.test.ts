import { describe, expect, it } from 'vitest'

import { fromWallClock, offsetMinutes, slotsForLocalDay, toWallClock } from '@/server/time'

const iso = (d: Date) => d.toISOString()

describe('time zone handling (America/Toronto)', () => {
  it('knows standard and daylight offsets', () => {
    expect(offsetMinutes(new Date('2027-01-15T12:00:00Z'))).toBe(-300)
    expect(offsetMinutes(new Date('2027-07-15T12:00:00Z'))).toBe(-240)
  })

  it('round-trips an ordinary wall-clock time', () => {
    const d = fromWallClock({ year: 2027, month: 3, day: 1, hour: 9, minute: 30 })
    expect(iso(d)).toBe('2027-03-01T14:30:00.000Z')
    expect(toWallClock(d)).toMatchObject({ year: 2027, month: 3, day: 1, hour: 9, minute: 30 })
  })

  it('spring forward 14 Mar 2027: 02:30 does not exist and moves forward to 03:30 EDT', () => {
    const d = fromWallClock({ year: 2027, month: 3, day: 14, hour: 2, minute: 30 })
    expect(iso(d)).toBe('2027-03-14T07:30:00.000Z')
    expect(toWallClock(d)).toMatchObject({ hour: 3, minute: 30 })
  })

  it('fall back 1 Nov 2026: 01:30 happens twice; the earlier (EDT) instant is used', () => {
    const d = fromWallClock({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 })
    expect(iso(d)).toBe('2026-11-01T05:30:00.000Z')
  })

  it.each([
    ['fall back', { year: 2026, month: 11, day: 1 }],
    ['spring forward', { year: 2027, month: 3, day: 14 }],
    ['ordinary day', { year: 2027, month: 3, day: 15 }],
  ])('%s: 08:00–21:00 in 60-minute slots gives 13 unique, contiguous slots', (_, date) => {
    const slots = slotsForLocalDay(date, { hour: 8, minute: 0 }, { hour: 21, minute: 0 }, 60)
    expect(slots).toHaveLength(13)
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(13)
    for (let i = 1; i < slots.length; i++)
      expect(slots[i].startsAt.getTime()).toBe(slots[i - 1].endsAt.getTime())
    expect(toWallClock(slots[0].startsAt)).toMatchObject({ hour: 8, minute: 0 })
    expect(toWallClock(slots[12].endsAt)).toMatchObject({ hour: 21, minute: 0 })
  })

  it('overnight window on spring-forward day: the nonexistent 02:00 slot is skipped, no duplicates', () => {
    const spring = slotsForLocalDay(
      { year: 2027, month: 3, day: 14 },
      { hour: 0, minute: 0 },
      { hour: 6, minute: 0 },
      60,
    )
    expect(spring.map((s) => toWallClock(s.startsAt).hour)).toEqual([0, 1, 3, 4, 5])
    expect(new Set(spring.map((s) => s.startsAt.getTime())).size).toBe(5)
    expect(spring.every((s) => s.endsAt.getTime() > s.startsAt.getTime())).toBe(true)
  })

  it('overnight window on fall-back day keeps 6 unique slots; the 01:00 slot lasts two real hours', () => {
    const fall = slotsForLocalDay(
      { year: 2026, month: 11, day: 1 },
      { hour: 0, minute: 0 },
      { hour: 6, minute: 0 },
      60,
    )
    expect(fall).toHaveLength(6)
    expect(new Set(fall.map((s) => s.startsAt.getTime())).size).toBe(6)
    const oneAm = fall[1]
    expect((oneAm.endsAt.getTime() - oneAm.startsAt.getTime()) / 36e5).toBe(2)
  })

  it('rejects invalid slot lengths', () => {
    expect(() =>
      slotsForLocalDay(
        { year: 2027, month: 1, day: 1 },
        { hour: 8, minute: 0 },
        { hour: 9, minute: 0 },
        0,
      ),
    ).toThrow()
  })
})
