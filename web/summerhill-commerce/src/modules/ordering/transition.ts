import { randomInt } from 'node:crypto'

import { emit, raiseAlert, type Actor } from '@/modules/ops'
import { bookSlotHold, releaseSlotHold } from '@/modules/scheduling'
import type { Db } from '@/server/db'
import { withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { canTransition, type OrderStatus } from './stateMachine'

export interface TransitionOptions {
  reason?: string | null
  data?: Record<string, unknown>
  requestId?: string | null
}

export interface TransitionResult {
  orderId: number
  publicId: string
  from: OrderStatus
  to: OrderStatus
}

export async function transitionInTx(
  tx: Db,
  orderId: number,
  from: OrderStatus | readonly OrderStatus[],
  to: OrderStatus,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  const fromList = typeof from === 'string' ? [from] : [...from]
  for (const f of fromList)
    if (!canTransition(f, to)) throw new Error(`illegal order transition ${f} → ${to}`)

  const { rows } = await tx.query<{ from_status: OrderStatus; public_id: string }>(
    `WITH prev AS (
       SELECT id, status FROM commerce.orders WHERE id = $1 AND status = ANY($2::text[]) FOR UPDATE)
     UPDATE commerce.orders o
     SET status = $3,
         placed_at = CASE WHEN $3 = 'placed' THEN now() ELSE o.placed_at END,
         pickup_code = CASE WHEN $3 = 'placed' THEN COALESCE(o.pickup_code, $4) ELSE o.pickup_code END
     FROM prev WHERE o.id = prev.id
     RETURNING prev.status AS from_status, o.public_id`,
    [orderId, fromList, to, pickupCode()],
  )
  if (!rows[0]) {
    const current = await tx.query<{ status: string }>(
      'SELECT status FROM commerce.orders WHERE id = $1',
      [orderId],
    )
    if (!current.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      `Order is ${current.rows[0].status}, expected ${fromList.join(' or ')}`,
      { status: current.rows[0].status },
    )
  }
  const result: TransitionResult = {
    orderId,
    publicId: rows[0].public_id,
    from: rows[0].from_status,
    to,
  }
  await tx.query(
    `INSERT INTO commerce.order_events
       (order_id, type, from_status, to_status, actor_type, actor_id, reason, data, request_id)
     VALUES ($1, 'status_changed', $2, $3, $4, $5, $6, $7, $8)`,
    [
      orderId,
      result.from,
      to,
      actor.type,
      actor.id,
      opts.reason ?? null,
      opts.data ?? {},
      opts.requestId ?? null,
    ],
  )
  if (to === 'placed') {
    const booking = await bookSlotHold(tx, orderId)
    if (booking === 'overbooked')
      await raiseAlert(tx, {
        kind: 'slot.overbooked',
        dedupeKey: `slot-overbooked:${orderId}`,
        severity: 'warning',
        message: `Order ${result.publicId} was paid after its slot hold expired and the slot filled up; it was booked over capacity`,
        data: { orderId },
      })
  } else if (to === 'abandoned' || to === 'cancelled') await releaseSlotHold(tx, orderId)
  await emit(tx, `order.${to}`, orderId, {
    orderId,
    publicId: result.publicId,
    from: result.from,
    to,
    reason: opts.reason ?? null,
  })
  return result
}

export function pickupCode(): string {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

export function transition(
  orderId: number,
  from: OrderStatus | readonly OrderStatus[],
  to: OrderStatus,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  return withTransaction((tx) => transitionInTx(tx, orderId, from, to, actor, opts))
}

export async function recordOrderEvent(
  db: Db,
  orderId: number,
  type: string,
  actor: Actor,
  data: Record<string, unknown> = {},
  reason: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO commerce.order_events (order_id, type, actor_type, actor_id, reason, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, type, actor.type, actor.id, reason, data],
  )
}
