import { mlbToLb } from '@/modules/pricing'
import type { Db } from '@/server/db'

import type { OrderLine } from './repository'
import type { OrderStatus } from './stateMachine'

/**
 * Picking records (G4-08/09/12). Line writes only; the orchestration (who may do what, when)
 * lives in the fulfilment module. Everything runs in the caller's transaction.
 */
export interface LinePick {
  status: 'picked' | 'unavailable'
  pickedQuantity: number | null
  actualWeightMlb: number | null
  labelPriceCents?: number | null
  scannedCode?: string | null
  unavailableReason?: string | null
  pickedBy?: string | null
}

export async function recordLinePick(tx: Db, lineId: number, pick: LinePick): Promise<void> {
  await tx.query(
    `UPDATE commerce.order_lines SET status = $2, picked_quantity = $3, actual_weight_lb = $4,
       label_price_cents = $5, scanned_code = $6, unavailable_reason = $7, picked_by = $8,
       picked_at = now()
     WHERE id = $1`,
    [
      lineId,
      pick.status,
      pick.pickedQuantity,
      pick.actualWeightMlb === null ? null : mlbToLb(pick.actualWeightMlb),
      pick.labelPriceCents ?? null,
      pick.scannedCode ?? null,
      pick.unavailableReason ?? null,
      pick.pickedBy ?? null,
    ],
  )
}

/** Puts a line back to "not picked yet" (the picker undoes an action before completing). */
export async function resetLinePick(tx: Db, lineId: number): Promise<void> {
  await tx.query(
    `UPDATE commerce.order_lines SET status = 'ordered', picked_quantity = NULL,
       actual_weight_lb = NULL, label_price_cents = NULL, scanned_code = NULL,
       unavailable_reason = NULL, substitution_reason = NULL, picked_by = NULL, picked_at = NULL
     WHERE id = $1`,
    [lineId],
  )
}

export interface SubstituteSnapshot {
  productId: string
  name: string
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  unit: 'ea' | 'lb'
  regularUnitPriceCents: number
  unitPriceCents: number
  promoLabel: string | null
  isWeighed: boolean
  taxCode: 'ZERO_RATED' | 'HST_STANDARD'
  taxRateBp: number
  depositCentsPerUnit: number
  upc: string | null
  category: string | null
}

/**
 * Adds the substitute as its own line pointing at the original (ORDERS §6), already picked, and
 * marks the original `substituted`. The substitute's estimate is its own price for what was
 * picked; what the customer pays is capped at the original line's estimate by finalizeOrder.
 */
export async function insertSubstituteLine(
  tx: Db,
  original: OrderLine,
  orderId: number,
  sub: SubstituteSnapshot,
  pick: {
    quantity: number | null
    weightMlb: number | null
    lineTotalCents: number
    taxCents: number
    labelPriceCents: number | null
    scannedCode: string | null
    reason: string | null
    pickedBy: string
  },
): Promise<number> {
  const { rows: next } = await tx.query<{ n: number }>(
    'SELECT COALESCE(max(line_no), 0)::int + 1 AS n FROM commerce.order_lines WHERE order_id = $1',
    [orderId],
  )
  const units = pick.quantity ?? 1
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO commerce.order_lines (order_id, line_no, product_id, name, pricing_model, sell_by,
       unit, regular_unit_price_cents, unit_price_cents, promo_label, quantity, requested_weight_lb,
       estimated_weight_lb, is_weighed, tax_code, tax_rate_bp, line_total_cents, tax_cents,
       deposit_cents, replacement_preference, status, substitutes_line_id, picked_quantity,
       actual_weight_lb, label_price_cents, scanned_code, substitution_reason, customer_decision,
       picked_by, picked_at, upc, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13, $14, $15, $16, $17, $18,
       'refund', 'picked', $19, $20, $21, $22, $23, $24, 'pending', $25, now(), $26, $27)
     RETURNING id`,
    [
      orderId,
      next[0].n,
      sub.productId,
      sub.name,
      sub.pricingModel,
      sub.sellBy,
      sub.unit,
      sub.regularUnitPriceCents,
      sub.unitPriceCents,
      sub.promoLabel,
      pick.quantity,
      pick.weightMlb === null ? null : mlbToLb(pick.weightMlb),
      sub.isWeighed,
      sub.taxCode,
      sub.taxRateBp,
      pick.lineTotalCents,
      pick.taxCents,
      sub.depositCentsPerUnit * units,
      original.id,
      pick.quantity,
      pick.weightMlb === null ? null : mlbToLb(pick.weightMlb),
      pick.labelPriceCents,
      pick.scannedCode,
      pick.reason,
      pick.pickedBy,
      sub.upc,
      sub.category,
    ],
  )
  await tx.query(
    `UPDATE commerce.order_lines SET status = 'substituted', substitution_reason = $2,
       picked_by = $3, picked_at = now()
     WHERE id = $1`,
    [original.id, pick.reason, pick.pickedBy],
  )
  return Number(rows[0].id)
}

/** Removes a substitute (the picker changed their mind before completing picking). */
export async function deleteSubstituteLine(tx: Db, originalLineId: number): Promise<void> {
  await tx.query('DELETE FROM commerce.order_lines WHERE substitutes_line_id = $1', [
    originalLineId,
  ])
}

/**
 * The customer's answer to a substitute (G4-12). Rejecting makes the substitute `unavailable`
 * (charged 0) and the original stays `substituted` (also 0): the line is refunded in effect.
 */
export async function setSubstituteDecision(
  tx: Db,
  substituteLineId: number,
  decision: 'approved' | 'rejected',
): Promise<void> {
  await tx.query(
    `UPDATE commerce.order_lines SET customer_decision = $2, customer_decided_at = now(),
       status = CASE WHEN $2 = 'rejected' THEN 'unavailable' ELSE status END
     WHERE id = $1 AND substitutes_line_id IS NOT NULL`,
    [substituteLineId, decision],
  )
}

/** Orders of the given locations and statuses, for the console queue. */
export async function listOrderIdsForLocations(
  db: Db,
  locationIds: number[],
  statuses: readonly OrderStatus[],
  opts: { since?: Date; limit?: number } = {},
): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM commerce.orders
     WHERE location_id = ANY($1::bigint[]) AND status = ANY($2::text[])
       AND ($3::timestamptz IS NULL OR updated_at >= $3)
     ORDER BY COALESCE(pickup_starts_at, placed_at, created_at), id
     LIMIT $4`,
    [locationIds, statuses, opts.since ?? null, opts.limit ?? 200],
  )
  return rows.map((r) => Number(r.id))
}
