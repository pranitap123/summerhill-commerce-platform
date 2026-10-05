import { audit, emit, type Actor } from '@/modules/ops'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { DEFAULT_WEEKLY_HOURS, type ScheduleSettings, type WeeklyHours } from './schedule'
import { generateSlots } from './slots'

/**
 * Location settings (G4-01, M10/M13): opening hours, slot length and capacity, lead time, holiday
 * closures and the pause switch. Every change is audited and regenerates the location's FUTURE
 * slots in the same transaction (slots that already have bookings are never shrunk below them;
 * see generateSlots). Only an owner may change them (enforced by the console routes).
 */
export interface LocationSettings extends ScheduleSettings {
  locationId: number
  merchantId: number
  locationName: string
  paused: boolean
  pauseReason: string | null
  /** GS1 variable-measure label layout; validated by the fulfilment module. */
  scaleBarcode: Record<string, unknown>
  updatedBy: string | null
  updatedAt: Date | null
}

export interface Closure {
  date: string // YYYY-MM-DD, local
  reason: string
}

type Row = Record<string, unknown>

function toSettings(r: Row): LocationSettings {
  return {
    locationId: Number(r.location_id),
    merchantId: Number(r.merchant_id),
    locationName: String(r.location_name),
    timeZone: String(r.timezone),
    weeklyHours: (r.weekly_hours as WeeklyHours | null) ?? DEFAULT_WEEKLY_HOURS,
    slotMinutes: Number(r.slot_minutes ?? 60),
    slotCapacity: Number(r.slot_capacity ?? 5),
    leadTimeMinutes: Number(r.lead_time_minutes ?? 120),
    paused: Boolean(r.paused),
    pauseReason: (r.pause_reason as string | null) ?? null,
    scaleBarcode: (r.scale_barcode as Record<string, unknown> | null) ?? {},
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: (r.updated_at as Date | null) ?? null,
  }
}

const SETTINGS_SQL = `SELECT l.id AS location_id, l.merchant_id, l.name AS location_name, l.timezone,
    s.weekly_hours, s.slot_minutes, s.slot_capacity, s.lead_time_minutes, s.paused, s.pause_reason,
    s.scale_barcode, s.updated_by, s.updated_at
  FROM merchant.locations l LEFT JOIN merchant.location_settings s ON s.location_id = l.id`

/** Settings of a location (defaults when the location has no settings row yet); null if unknown. */
export async function getLocationSettings(
  locationId: number,
  db: Db = getDb(),
): Promise<LocationSettings | null> {
  const { rows } = await db.query(`${SETTINGS_SQL} WHERE l.id = $1`, [locationId])
  return rows[0] ? toSettings(rows[0]) : null
}

export async function listLocationSettings(db: Db = getDb()): Promise<LocationSettings[]> {
  const { rows } = await db.query(`${SETTINGS_SQL} ORDER BY l.id`)
  return rows.map(toSettings)
}

/** Holiday closures from `fromDate` (YYYY-MM-DD, local) on. */
export async function listClosures(
  locationId: number,
  fromDate: string | null = null,
  db: Db = getDb(),
): Promise<Closure[]> {
  const { rows } = await db.query<{ closed_on: string; reason: string }>(
    `SELECT to_char(closed_on, 'YYYY-MM-DD') AS closed_on, reason FROM merchant.location_closures
     WHERE location_id = $1 AND ($2::date IS NULL OR closed_on >= $2::date) ORDER BY closed_on`,
    [locationId, fromDate],
  )
  return rows.map((r) => ({ date: r.closed_on, reason: r.reason }))
}

export interface SettingsPatch {
  weeklyHours?: WeeklyHours
  slotMinutes?: number
  slotCapacity?: number
  leadTimeMinutes?: number
  paused?: boolean
  pauseReason?: string | null
  scaleBarcode?: Record<string, unknown>
}

// Column names come from this closed map, never from input.
const COLUMNS: Record<keyof SettingsPatch, string> = {
  weeklyHours: 'weekly_hours',
  slotMinutes: 'slot_minutes',
  slotCapacity: 'slot_capacity',
  leadTimeMinutes: 'lead_time_minutes',
  paused: 'paused',
  pauseReason: 'pause_reason',
  scaleBarcode: 'scale_barcode',
}

export async function updateLocationSettings(
  locationId: number,
  patch: SettingsPatch,
  actor: Actor,
  opts: { requestId?: string | null; now?: Date } = {},
): Promise<LocationSettings> {
  const keys = (Object.keys(patch) as Array<keyof SettingsPatch>).filter(
    (k) => patch[k] !== undefined,
  )
  return withTransaction(async (tx) => {
    const before = await getLocationSettings(locationId, tx)
    if (!before) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
    await tx.query(
      'INSERT INTO merchant.location_settings (location_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [locationId],
    )
    if (keys.length) {
      const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 3}`)
      await tx.query(
        `UPDATE merchant.location_settings SET ${sets.join(', ')}, updated_by = $2
         WHERE location_id = $1`,
        [
          locationId,
          `${actor.type}:${actor.id ?? '-'}`,
          ...keys.map((k) =>
            k === 'weeklyHours' || k === 'scaleBarcode' ? JSON.stringify(patch[k]) : patch[k],
          ),
        ],
      )
    }
    const after = (await getLocationSettings(locationId, tx))!
    await audit(tx, {
      actor,
      action: 'location.settings.update',
      targetType: 'location',
      targetId: locationId,
      data: { patch, before: settingsSnapshot(before) },
      requestId: opts.requestId,
    })
    if (patch.paused !== undefined && patch.paused !== before.paused)
      await emit(tx, patch.paused ? 'location.paused' : 'location.resumed', locationId, {
        locationId,
        merchantId: after.merchantId,
      })
    await generateSlots(tx, after, await listClosures(locationId, null, tx), opts.now ?? new Date())
    return after
  })
}

function settingsSnapshot(s: LocationSettings) {
  return {
    weeklyHours: s.weeklyHours,
    slotMinutes: s.slotMinutes,
    slotCapacity: s.slotCapacity,
    leadTimeMinutes: s.leadTimeMinutes,
    paused: s.paused,
    pauseReason: s.pauseReason,
    scaleBarcode: s.scaleBarcode,
  }
}

export async function addClosure(
  locationId: number,
  closure: Closure,
  actor: Actor,
  opts: { requestId?: string | null; now?: Date } = {},
): Promise<Closure[]> {
  return withTransaction(async (tx) => {
    const settings = await getLocationSettings(locationId, tx)
    if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
    await tx.query(
      `INSERT INTO merchant.location_closures (location_id, closed_on, reason, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (location_id, closed_on) DO UPDATE SET reason = EXCLUDED.reason`,
      [locationId, closure.date, closure.reason, `${actor.type}:${actor.id ?? '-'}`],
    )
    await audit(tx, {
      actor,
      action: 'location.closure.add',
      targetType: 'location',
      targetId: locationId,
      data: { ...closure },
      requestId: opts.requestId,
    })
    const closures = await listClosures(locationId, null, tx)
    await generateSlots(tx, settings, closures, opts.now ?? new Date())
    return closures
  })
}

export async function removeClosure(
  locationId: number,
  date: string,
  actor: Actor,
  opts: { requestId?: string | null; now?: Date } = {},
): Promise<Closure[]> {
  return withTransaction(async (tx) => {
    const settings = await getLocationSettings(locationId, tx)
    if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
    const { rowCount } = await tx.query(
      'DELETE FROM merchant.location_closures WHERE location_id = $1 AND closed_on = $2',
      [locationId, date],
    )
    if (!rowCount) throw new HttpError(404, 'NOT_FOUND', 'No closure on that date')
    await audit(tx, {
      actor,
      action: 'location.closure.remove',
      targetType: 'location',
      targetId: locationId,
      data: { date },
      requestId: opts.requestId,
    })
    const closures = await listClosures(locationId, null, tx)
    await generateSlots(tx, settings, closures, opts.now ?? new Date())
    return closures
  })
}

/** Nightly/hourly job: keeps every location's slots GENERATION_DAYS ahead. */
export async function generateAllSlots(now: Date = new Date()): Promise<number> {
  let upserted = 0
  for (const settings of await listLocationSettings()) {
    const closures = await listClosures(settings.locationId)
    const r = await withTransaction((tx) => generateSlots(tx, settings, closures, now))
    upserted += r.upserted
  }
  return upserted
}
