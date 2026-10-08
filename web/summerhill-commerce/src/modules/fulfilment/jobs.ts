import { raiseAlert, type Actor } from '@/modules/ops'
import { getOrder, recordOrderEvent, transition } from '@/modules/ordering'
import { voidOrder } from '@/modules/payments'
import { getDb, withTransaction } from '@/server/db'
import { getLogger } from '@/server/logger'

import { AUTO_REJECT_AFTER_MS, ESCALATE_AFTER_MS } from './console'

const SYSTEM: Actor = { type: 'system', id: null }

export const NO_SHOW_AFTER_MS = 24 * 3600_000

export async function runAcceptanceSweep(
  now: Date = new Date(),
): Promise<{ escalated: number; autoRejected: number }> {
  const db = getDb()
  const escalate = await db.query<{ id: string; public_id: string; location_id: string }>(
    `SELECT id, public_id, location_id FROM commerce.orders
     WHERE status = 'placed' AND escalated_at IS NULL AND placed_at <= $1`,
    [new Date(now.getTime() - ESCALATE_AFTER_MS)],
  )
  let escalated = 0
  for (const o of escalate.rows)
    await withTransaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE commerce.orders SET escalated_at = $2
         WHERE id = $1 AND status = 'placed' AND escalated_at IS NULL`,
        [o.id, now],
      )
      if (!rowCount) return
      escalated++
      await recordOrderEvent(tx, Number(o.id), 'acceptance_escalated', SYSTEM)
      await raiseAlert(tx, {
        kind: 'order.unaccepted',
        dedupeKey: `order-unaccepted:${o.id}`,
        severity: 'warning',
        message: `Order ${o.public_id} has not been accepted after 10 minutes`,
        data: { orderId: Number(o.id), locationId: Number(o.location_id) },
      })
    })

  const late = await db.query<{ id: string }>(
    `SELECT id FROM commerce.orders WHERE status = 'placed' AND placed_at <= $1`,
    [new Date(now.getTime() - AUTO_REJECT_AFTER_MS)],
  )
  let autoRejected = 0
  for (const o of late.rows) {
    try {
      await voidOrder(Number(o.id), SYSTEM, 'auto_rejected')
      autoRejected++
    } catch (err) {
      getLogger().warn({ err, orderId: o.id }, 'auto-reject skipped an order')
    }
  }
  return { escalated, autoRejected }
}

export async function runNoShowSweep(now: Date = new Date()): Promise<number> {
  const { rows } = await getDb().query<{ id: string }>(
    `SELECT id FROM commerce.orders
     WHERE status = 'ready' AND pickup_ends_at IS NOT NULL AND pickup_ends_at <= $1`,
    [new Date(now.getTime() - NO_SHOW_AFTER_MS)],
  )
  let marked = 0
  for (const r of rows) {
    const order = await getOrder(Number(r.id))
    if (order?.status !== 'ready') continue
    try {
      await transition(order.id, 'ready', 'no_show', SYSTEM, { reason: 'not_collected' })
      marked++
    } catch (err) {
      getLogger().warn({ err, orderId: r.id }, 'no-show sweep skipped an order')
    }
  }
  return marked
}
