import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { fromWallClock } from '@/server/time'

import {
  addDays,
  GENERATION_DAYS,
  localDate,
  plannedSlots,
  slotRejection,
  type OfferContext,
} from './schedule'
import type { Closure, LocationSettings } from './settings'

/**
 * Pickup slots and holds (G4-02, ORDERS §3). Slots are materialised GENERATION_DAYS ahead; a hold
 * is taken in the checkout transaction with
 *   UPDATE slots SET held = held + 1 WHERE id = $1 AND booked + held < capacity
 * so concurrent checkouts can never overbook (the row lock serialises them, and the loser sees the
 * updated counters). A hold becomes a booking when the payment is authorised, and is released when
 * checkout is abandoned, the order is cancelled, or it expires.
 */
export interface SlotRow {
  id: number
  locationId: number
  startsAt: Date
  endsAt: Date
  capacity: number
  booked: number
  held: number
  closed: boolean
}

const SLOT_COLUMNS = 'id, location_id, starts_at, ends_at, capacity, booked, held, closed'

function toSlot(r: Record<string, unknown>): SlotRow {
  return {
    id: Number(r.id),
    locationId: Number(r.location_id),
    startsAt: r.starts_at as Date,
    endsAt: r.ends_at as Date,
    capacity: Number(r.capacity),
    booked: Number(r.booked),
    held: Number(r.held),
    closed: Boolean(r.closed),
  }
}

export interface GenerationResult {
  upserted: number
  removed: number
  closed: number
}

/**
 * Brings a location's future slots in line with its settings for the next `days` local dates:
 *  - planned slots are created, or updated (end time, capacity) if they start in the future;
 *    capacity never drops below what is already booked + held
 *  - future slots no longer planned (hours changed, holiday closure) are deleted when nobody ever
 *    held them, else marked closed: existing orders keep their pickup time, nobody new can book
 * Idempotent; runs in the caller's transaction.
 */
export async function generateSlots(
  db: Db,
  settings: LocationSettings,
  closures: readonly Closure[],
  now: Date,
  days = GENERATION_DAYS,
): Promise<GenerationResult> {
  const planned = plannedSlots(settings, new Set(closures.map((c) => c.date)), now, days)
  const rangeEnd = fromWallClock(
    { ...addDays(localDate(now, settings.timeZone), days), hour: 0, minute: 0 },
    settings.timeZone,
  )
  const starts = planned.map((s) => s.startsAt)
  const upsert = await db.query(
    `INSERT INTO commerce.slots (location_id, starts_at, ends_at, capacity)
     SELECT $1, s, e, $4 FROM unnest($2::timestamptz[], $3::timestamptz[]) AS t(s, e)
     WHERE s > $5
     ON CONFLICT (location_id, starts_at) DO UPDATE
       SET ends_at = EXCLUDED.ends_at,
           capacity = GREATEST(EXCLUDED.capacity, commerce.slots.booked + commerce.slots.held),
           closed = false
       WHERE commerce.slots.ends_at <> EXCLUDED.ends_at
          OR commerce.slots.capacity <> GREATEST(EXCLUDED.capacity, commerce.slots.booked + commerce.slots.held)
          OR commerce.slots.closed`,
    [settings.locationId, starts, planned.map((s) => s.endsAt), settings.slotCapacity, now],
  )
  const removed = await db.query(
    `DELETE FROM commerce.slots s
     WHERE s.location_id = $1 AND s.starts_at > $2 AND s.starts_at < $3
       AND s.starts_at <> ALL($4::timestamptz[])
       AND NOT EXISTS (SELECT 1 FROM commerce.slot_holds h WHERE h.slot_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM commerce.orders o WHERE o.slot_id = s.id)`,
    [settings.locationId, now, rangeEnd, starts],
  )
  const closed = await db.query(
    `UPDATE commerce.slots SET closed = true
     WHERE location_id = $1 AND starts_at > $2 AND starts_at < $3
       AND starts_at <> ALL($4::timestamptz[]) AND NOT closed`,
    [settings.locationId, now, rangeEnd, starts],
  )
  return {
    upserted: upsert.rowCount ?? 0,
    removed: removed.rowCount ?? 0,
    closed: closed.rowCount ?? 0,
  }
}

/** Slots of a location between two instants (the console's day view, tests). */
export async function listSlots(
  locationId: number,
  from: Date,
  to: Date,
  db: Db = getDb(),
): Promise<SlotRow[]> {
  const { rows } = await db.query(
    `SELECT ${SLOT_COLUMNS} FROM commerce.slots
     WHERE location_id = $1 AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at`,
    [locationId, from, to],
  )
  return rows.map(toSlot)
}

export async function getSlot(id: number, db: Db = getDb()): Promise<SlotRow | null> {
  const { rows } = await db.query(`SELECT ${SLOT_COLUMNS} FROM commerce.slots WHERE id = $1`, [id])
  return rows[0] ? toSlot(rows[0]) : null
}

export interface OfferedSlot {
  id: number
  startsAt: Date
  endsAt: Date
  remaining: number
}

/**
 * Slots a cart may choose (G4-03): open, with capacity left, after the lead time, within the
 * booking window, and on a weekday every item is available. Generates the location's slots
 * first if they don't reach the end of the booking window yet (e.g. before the worker ran).
 */
export async function availableSlots(
  settings: LocationSettings,
  closures: readonly Closure[],
  ctx: Omit<OfferContext, 'leadTimeMinutes' | 'timeZone'>,
): Promise<OfferedSlot[]> {
  if (settings.paused) return []
  const offer: OfferContext = {
    ...ctx,
    leadTimeMinutes: settings.leadTimeMinutes,
    timeZone: settings.timeZone,
  }
  const horizon = new Date(ctx.now.getTime() + 6 * 86_400_000)
  const { rows } = await getDb().query<{ latest: Date | null }>(
    'SELECT max(starts_at) AS latest FROM commerce.slots WHERE location_id = $1',
    [settings.locationId],
  )
  if (!rows[0].latest || rows[0].latest < new Date(ctx.now.getTime() + 4 * 86_400_000))
    await withTransaction((tx) => generateSlots(tx, settings, closures, ctx.now))
  const slots = await listSlots(settings.locationId, ctx.now, horizon)
  return slots
    .filter((s) => !s.closed && s.booked + s.held < s.capacity && !slotRejection(s, offer))
    .map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      remaining: s.capacity - s.booked - s.held,
    }))
}

const REJECTION_MESSAGES = {
  past_lead_time: 'That pickup time is too soon. Please choose a later time.',
  beyond_window: 'That pickup time is too far ahead. Please choose a time within 5 days.',
  item_not_available_that_day:
    'An item in your cart is not available on that day. Please choose another day.',
} as const

/**
 * Takes a hold on a slot for a pending order, in the checkout transaction. Throws 422
 * SLOT_INVALID when the slot can't be offered to this cart, 409 SLOT_UNAVAILABLE when it's full.
 */
export async function holdSlot(
  tx: Db,
  input: {
    slotId: number
    orderId: number
    settings: LocationSettings
    itemAvailableDays: ReadonlyArray<readonly number[]>
    now: Date
    expiresAt: Date
  },
): Promise<SlotRow> {
  const slot = await getSlot(input.slotId, tx)
  if (!slot || slot.locationId !== input.settings.locationId)
    throw new HttpError(422, 'SLOT_INVALID', 'Please choose a pickup time from the list')
  const rejection = slotRejection(slot, {
    now: input.now,
    leadTimeMinutes: input.settings.leadTimeMinutes,
    timeZone: input.settings.timeZone,
    itemAvailableDays: input.itemAvailableDays,
  })
  if (rejection)
    throw new HttpError(422, 'SLOT_INVALID', REJECTION_MESSAGES[rejection], { reason: rejection })
  const { rows } = await tx.query(
    `UPDATE commerce.slots SET held = held + 1
     WHERE id = $1 AND NOT closed AND booked + held < capacity
     RETURNING ${SLOT_COLUMNS}`,
    [input.slotId],
  )
  if (!rows[0])
    throw new HttpError(
      409,
      'SLOT_UNAVAILABLE',
      'That pickup time was just taken. Please choose another time.',
    )
  await tx.query(
    `INSERT INTO commerce.slot_holds (slot_id, order_id, expires_at) VALUES ($1, $2, $3)`,
    [input.slotId, input.orderId, input.expiresAt],
  )
  await tx.query(
    `UPDATE commerce.orders SET slot_id = $2, pickup_starts_at = $3, pickup_ends_at = $4
     WHERE id = $1`,
    [input.orderId, slot.id, slot.startsAt, slot.endsAt],
  )
  return toSlot(rows[0])
}

/**
 * The payment was authorised: the hold becomes a booking. A hold that already expired (payment
 * completed after the release job ran) is re-booked; if the slot filled up in the meantime the
 * paid order is still honoured and the slot is marked over capacity ('overbooked').
 */
export async function bookSlotHold(
  tx: Db,
  orderId: number,
): Promise<'booked' | 'rebooked' | 'overbooked' | 'none'> {
  const { rows } = await tx.query<{ slot_id: string; status: string }>(
    `SELECT slot_id, status FROM commerce.slot_holds WHERE order_id = $1 FOR UPDATE`,
    [orderId],
  )
  const hold = rows[0]
  if (!hold || hold.status === 'booked') return 'none'
  await tx.query(`UPDATE commerce.slot_holds SET status = 'booked' WHERE order_id = $1`, [orderId])
  if (hold.status === 'held') {
    await tx.query('UPDATE commerce.slots SET held = held - 1, booked = booked + 1 WHERE id = $1', [
      hold.slot_id,
    ])
    return 'booked'
  }
  const rebooked = await tx.query(
    `UPDATE commerce.slots SET booked = booked + 1
     WHERE id = $1 AND booked + held < capacity`,
    [hold.slot_id],
  )
  if (rebooked.rowCount) return 'rebooked'
  await tx.query(
    'UPDATE commerce.slots SET booked = booked + 1, capacity = booked + held + 1 WHERE id = $1',
    [hold.slot_id],
  )
  return 'overbooked'
}

/** Frees the order's place in its slot (abandoned checkout, cancellation). Idempotent. */
export async function releaseSlotHold(tx: Db, orderId: number): Promise<'released' | 'none'> {
  const { rows } = await tx.query<{ slot_id: string; status: 'held' | 'booked' }>(
    `WITH h AS (
       SELECT id, slot_id, status FROM commerce.slot_holds
       WHERE order_id = $1 AND status <> 'released' FOR UPDATE)
     UPDATE commerce.slot_holds s SET status = 'released' FROM h WHERE s.id = h.id
     RETURNING h.slot_id, h.status`,
    [orderId],
  )
  if (!rows[0]) return 'none'
  const counter = rows[0].status === 'held' ? 'held' : 'booked'
  await tx.query(`UPDATE commerce.slots SET ${counter} = ${counter} - 1 WHERE id = $1`, [
    rows[0].slot_id,
  ])
  return 'released'
}

/** Release job (every minute): holds whose checkout never completed in time. */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const { rows } = await getDb().query<{ order_id: string }>(
    `SELECT order_id FROM commerce.slot_holds WHERE status = 'held' AND expires_at < $1`,
    [now],
  )
  let released = 0
  for (const r of rows)
    await withTransaction(async (tx) => {
      // Re-check under the lock: the payment may have booked it a moment ago.
      const { rows: still } = await tx.query(
        `SELECT 1 FROM commerce.slot_holds WHERE order_id = $1 AND status = 'held' AND expires_at < $2
         FOR UPDATE`,
        [r.order_id, now],
      )
      if (still[0] && (await releaseSlotHold(tx, Number(r.order_id))) === 'released') released++
    })
  return released
}
