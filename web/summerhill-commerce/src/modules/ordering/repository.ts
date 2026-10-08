import { randomInt } from 'node:crypto'

import { lbToMlb, mlbToLb, type Quote, type TaxCode } from '@/modules/pricing'
import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import type { OrderStatus } from './stateMachine'

export interface Order {
  id: number
  publicId: string
  status: OrderStatus
  merchantId: number
  locationId: number
  cartId: string | null
  userId: string | null
  email: string
  pickupName: string | null
  currency: 'CAD'
  itemSubtotalCents: number
  depositCents: number
  taxCents: number
  estimatedTotalCents: number
  weightBufferCents: number
  authorizationCents: number
  finalItemSubtotalCents: number | null
  finalDepositCents: number | null
  finalTaxCents: number | null
  finalTotalCents: number | null
  feeScheduleId: number
  feeEstimateCents: number
  feeFinalCents: number | null
  quoteHash: string
  accessVersion: number
  refundStatus: 'none' | 'partial' | 'full'
  placedAt: Date | null
  createdAt: Date

  slotId: number | null
  pickupStartsAt: Date | null
  pickupEndsAt: Date | null

  pickupCode: string | null
  pickupCodeFailures: number
  pickupLockedAt: Date | null
  acceptedAt: Date | null
  acceptedBy: string | null
  escalatedAt: Date | null
  pickerId: string | null
  pickStartedAt: Date | null
  pickCompletedAt: Date | null
  arrivedAt: Date | null
  arrivalNote: string | null
  collectedAt: Date | null
  handedOverBy: string | null
  rating: number | null
  ratingTags: string[]
  ratingComment: string | null
  ratedAt: Date | null
}

export interface OrderLine {
  id: number
  lineNo: number
  productId: string
  name: string
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  unit: 'ea' | 'lb'
  regularUnitPriceCents: number
  unitPriceCents: number
  promoLabel: string | null
  quantity: number | null
  requestedWeightMlb: number | null
  estimatedWeightMlb: number | null
  isWeighed: boolean
  taxCode: TaxCode
  taxRateBp: number
  lineTotalCents: number
  taxCents: number
  depositCents: number
  replacementPreference: 'best_match' | 'specific' | 'refund'
  replacementProductIds: string[]
  note: string | null
  status: 'ordered' | 'picked' | 'unavailable' | 'substituted'
  substitutesLineId: number | null
  pickedQuantity: number | null
  actualWeightMlb: number | null
  finalLineTotalCents: number | null
  finalTaxCents: number | null
  finalDepositCents: number | null

  upc: string | null
  category: string | null
  labelPriceCents: number | null
  scannedCode: string | null
  unavailableReason: string | null
  substitutionReason: string | null
  customerDecision: 'pending' | 'approved' | 'rejected' | null
  pickedBy: string | null
  pickedAt: Date | null
}

export interface OrderEvent {
  id: number
  type: string
  fromStatus: string | null
  toStatus: string | null
  actorType: string
  actorId: string | null
  reason: string | null
  data: Record<string, unknown>
  at: Date
}

const ORDER_COLUMNS = `id, public_id, status, merchant_id, location_id, cart_id, user_id, email, pickup_name,
  currency, item_subtotal_cents, deposit_cents, tax_cents, estimated_total_cents, weight_buffer_cents,
  authorization_cents, final_item_subtotal_cents, final_deposit_cents, final_tax_cents, final_total_cents,
  fee_schedule_id, fee_estimate_cents, fee_final_cents, quote_hash, access_version, refund_status,
  placed_at, created_at, slot_id, pickup_starts_at, pickup_ends_at, pickup_code, pickup_code_failures,
  pickup_locked_at, accepted_at, accepted_by, escalated_at, picker_id, pick_started_at,
  pick_completed_at, arrived_at, arrival_note, collected_at, handed_over_by, rating, rating_tags,
  rating_comment, rated_at`

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v)
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const mlbOrNull = (v: unknown) => (v === null || v === undefined ? null : lbToMlb(String(v)))
const dateOrNull = (v: unknown) => (v === null || v === undefined ? null : (v as Date))

function toOrder(r: Row): Order {
  return {
    id: num(r.id),
    publicId: String(r.public_id),
    status: r.status as OrderStatus,
    merchantId: num(r.merchant_id),
    locationId: num(r.location_id),
    cartId: (r.cart_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    email: String(r.email),
    pickupName: (r.pickup_name as string) ?? null,
    currency: 'CAD',
    itemSubtotalCents: num(r.item_subtotal_cents),
    depositCents: num(r.deposit_cents),
    taxCents: num(r.tax_cents),
    estimatedTotalCents: num(r.estimated_total_cents),
    weightBufferCents: num(r.weight_buffer_cents),
    authorizationCents: num(r.authorization_cents),
    finalItemSubtotalCents: numOrNull(r.final_item_subtotal_cents),
    finalDepositCents: numOrNull(r.final_deposit_cents),
    finalTaxCents: numOrNull(r.final_tax_cents),
    finalTotalCents: numOrNull(r.final_total_cents),
    feeScheduleId: num(r.fee_schedule_id),
    feeEstimateCents: num(r.fee_estimate_cents),
    feeFinalCents: numOrNull(r.fee_final_cents),
    quoteHash: String(r.quote_hash),
    accessVersion: num(r.access_version),
    refundStatus: r.refund_status as Order['refundStatus'],
    placedAt: (r.placed_at as Date) ?? null,
    createdAt: r.created_at as Date,
    slotId: numOrNull(r.slot_id),
    pickupStartsAt: dateOrNull(r.pickup_starts_at),
    pickupEndsAt: dateOrNull(r.pickup_ends_at),
    pickupCode: (r.pickup_code as string) ?? null,
    pickupCodeFailures: num(r.pickup_code_failures ?? 0),
    pickupLockedAt: dateOrNull(r.pickup_locked_at),
    acceptedAt: dateOrNull(r.accepted_at),
    acceptedBy: (r.accepted_by as string) ?? null,
    escalatedAt: dateOrNull(r.escalated_at),
    pickerId: (r.picker_id as string) ?? null,
    pickStartedAt: dateOrNull(r.pick_started_at),
    pickCompletedAt: dateOrNull(r.pick_completed_at),
    arrivedAt: dateOrNull(r.arrived_at),
    arrivalNote: (r.arrival_note as string) ?? null,
    collectedAt: dateOrNull(r.collected_at),
    handedOverBy: (r.handed_over_by as string) ?? null,
    rating: numOrNull(r.rating),
    ratingTags: (r.rating_tags as string[]) ?? [],
    ratingComment: (r.rating_comment as string) ?? null,
    ratedAt: dateOrNull(r.rated_at),
  }
}

function toLine(r: Row): OrderLine {
  return {
    id: num(r.id),
    lineNo: num(r.line_no),
    productId: String(r.product_id),
    name: String(r.name),
    pricingModel: r.pricing_model as OrderLine['pricingModel'],
    sellBy: r.sell_by as OrderLine['sellBy'],
    unit: r.unit as OrderLine['unit'],
    regularUnitPriceCents: num(r.regular_unit_price_cents),
    unitPriceCents: num(r.unit_price_cents),
    promoLabel: (r.promo_label as string) ?? null,
    quantity: numOrNull(r.quantity),
    requestedWeightMlb: mlbOrNull(r.requested_weight_lb),
    estimatedWeightMlb: mlbOrNull(r.estimated_weight_lb),
    isWeighed: Boolean(r.is_weighed),
    taxCode: r.tax_code as TaxCode,
    taxRateBp: num(r.tax_rate_bp),
    lineTotalCents: num(r.line_total_cents),
    taxCents: num(r.tax_cents),
    depositCents: num(r.deposit_cents),
    replacementPreference: r.replacement_preference as OrderLine['replacementPreference'],
    replacementProductIds: (r.replacement_product_ids as string[]) ?? [],
    note: (r.note as string) ?? null,
    status: r.status as OrderLine['status'],
    substitutesLineId: numOrNull(r.substitutes_line_id),
    pickedQuantity: numOrNull(r.picked_quantity),
    actualWeightMlb: mlbOrNull(r.actual_weight_lb),
    finalLineTotalCents: numOrNull(r.final_line_total_cents),
    finalTaxCents: numOrNull(r.final_tax_cents),
    finalDepositCents: numOrNull(r.final_deposit_cents),
    upc: (r.upc as string) ?? null,
    category: (r.category as string) ?? null,
    labelPriceCents: numOrNull(r.label_price_cents),
    scannedCode: (r.scanned_code as string) ?? null,
    unavailableReason: (r.unavailable_reason as string) ?? null,
    substitutionReason: (r.substitution_reason as string) ?? null,
    customerDecision: (r.customer_decision as OrderLine['customerDecision']) ?? null,
    pickedBy: (r.picked_by as string) ?? null,
    pickedAt: dateOrNull(r.picked_at),
  }
}

const PUBLIC_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export function generatePublicId(): string {
  let id = 'SH-'
  for (let i = 0; i < 6; i++) id += PUBLIC_ID_ALPHABET[randomInt(PUBLIC_ID_ALPHABET.length)]
  return id
}

export interface LineOptions {
  replacementPreference: 'best_match' | 'specific' | 'refund'
  replacementProductIds: string[]
  note: string | null
}

export async function insertPendingOrder(
  tx: Db,
  input: {
    quote: Quote
    cartId: string
    userId: string | null
    email: string
    pickupName: string | null
    lineOptions: Map<string, LineOptions>
  },
): Promise<Order> {
  const { quote } = input
  if (!quote.canCheckout || quote.merchantId === null || quote.locationId === null)
    throw new Error('cannot create an order from a quote with issues')

  let rows: Row[] = []
  for (let attempt = 0; ; attempt++) {
    const publicId = generatePublicId()
    await tx.query('SAVEPOINT order_public_id')
    try {
      ;({ rows } = await tx.query(
        `INSERT INTO commerce.orders (public_id, merchant_id, location_id, cart_id, user_id, email,
           pickup_name, item_subtotal_cents, deposit_cents, tax_cents, estimated_total_cents,
           weight_buffer_cents, authorization_cents, fee_schedule_id, fee_estimate_cents, quote_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING ${ORDER_COLUMNS}`,
        [
          publicId,
          quote.merchantId,
          quote.locationId,
          input.cartId,
          input.userId,
          input.email,
          input.pickupName,
          quote.itemSubtotalCents,
          quote.depositCents,
          quote.taxCents,
          quote.estimatedTotalCents,
          quote.weightBufferCents,
          quote.authorizationCents,
          quote.fee.scheduleId,
          quote.fee.applicationFeeCents,
          quote.hash,
        ],
      ))
      await tx.query('RELEASE SAVEPOINT order_public_id')
      break
    } catch (err) {
      await tx.query('ROLLBACK TO SAVEPOINT order_public_id')
      const e = err as { code?: string; constraint?: string }
      if (e.code === '23505' && e.constraint === 'orders_public_id_key' && attempt < 5) continue
      throw err
    }
  }
  const order = toOrder(rows[0])
  let lineNo = 0
  for (const l of quote.lines) {
    const opts = input.lineOptions.get(l.productId) ?? {
      replacementPreference: 'best_match' as const,
      replacementProductIds: [],
      note: null,
    }
    await tx.query(
      `INSERT INTO commerce.order_lines (order_id, line_no, product_id, name, pricing_model, sell_by,
             unit, regular_unit_price_cents, unit_price_cents, promo_label, quantity, requested_weight_lb,
             estimated_weight_lb, is_weighed, tax_code, tax_rate_bp, line_total_cents, tax_cents,
             deposit_cents, replacement_preference, replacement_product_ids, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22)`,
      [
        order.id,
        ++lineNo,
        l.productId,
        l.name,
        l.pricingModel,
        l.sellBy,
        l.unit,
        l.regularUnitPriceCents,
        l.unitPriceCents,
        l.promoLabel,
        l.quantity,
        l.requestedWeightMlb === null ? null : mlbToLb(l.requestedWeightMlb),
        l.estimatedWeightMlb === null ? null : mlbToLb(l.estimatedWeightMlb),
        l.isWeighed,
        l.taxCode,
        l.taxRateBp,
        l.lineTotalCents,
        l.taxCents,
        l.depositCents,
        opts.replacementPreference,
        opts.replacementProductIds,
        opts.note,
      ],
    )
  }

  await tx.query(
    `UPDATE commerce.order_lines ol SET upc = v.upc, category = v.category
     FROM catalog.product_view v WHERE ol.order_id = $1 AND v.id = ol.product_id`,
    [order.id],
  )
  return order
}

export async function getOrder(id: number, db: Db = getDb()): Promise<Order | null> {
  const { rows } = await db.query(`SELECT ${ORDER_COLUMNS} FROM commerce.orders WHERE id = $1`, [
    id,
  ])
  return rows[0] ? toOrder(rows[0]) : null
}

export async function getOrderForUpdate(tx: Db, id: number): Promise<Order | null> {
  const { rows } = await tx.query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return rows[0] ? toOrder(rows[0]) : null
}

export async function getOrderByPublicId(
  publicId: string,
  db: Db = getDb(),
): Promise<Order | null> {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders WHERE public_id = $1`,
    [publicId],
  )
  return rows[0] ? toOrder(rows[0]) : null
}

export async function findPendingOrderForCart(
  cartId: string,
  db: Db = getDb(),
): Promise<Order | null> {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders WHERE cart_id = $1 AND status = 'pending_payment'`,
    [cartId],
  )
  return rows[0] ? toOrder(rows[0]) : null
}

export async function getOrderLines(orderId: number, db: Db = getDb()): Promise<OrderLine[]> {
  const { rows } = await db.query(
    'SELECT * FROM commerce.order_lines WHERE order_id = $1 ORDER BY line_no',
    [orderId],
  )
  return rows.map(toLine)
}

export async function getOrderEvents(orderId: number, db: Db = getDb()): Promise<OrderEvent[]> {
  const { rows } = await db.query(
    `SELECT id, type, from_status, to_status, actor_type, actor_id, reason, data, at
     FROM commerce.order_events WHERE order_id = $1 ORDER BY id`,
    [orderId],
  )
  return rows.map((r) => ({
    id: num(r.id),
    type: r.type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorType: r.actor_type,
    actorId: r.actor_id,
    reason: r.reason,
    data: r.data,
    at: r.at,
  }))
}

export async function listOrdersForUser(userId: string, limit = 50): Promise<Order[]> {
  const { rows } = await getDb().query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders
     WHERE user_id = $1 AND status <> 'pending_payment' AND status <> 'abandoned'
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  )
  return rows.map(toOrder)
}

export async function listRecentOrders(params: {
  status?: OrderStatus
  limit: number
}): Promise<Order[]> {
  const { rows } = await getDb().query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders
     WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`,
    [params.status ?? null, params.limit],
  )
  return rows.map(toOrder)
}

export async function findOrderForLookup(publicId: string, email: string): Promise<Order | null> {
  const { rows } = await getDb().query(
    `SELECT ${ORDER_COLUMNS} FROM commerce.orders
     WHERE public_id = $1 AND lower(email) = lower($2) AND status <> 'pending_payment'`,
    [publicId, email],
  )
  return rows[0] ? toOrder(rows[0]) : null
}

export async function recordPick(
  tx: Db,
  lineId: number,
  pick: {
    status: 'picked' | 'unavailable'
    pickedQuantity: number | null
    actualWeightMlb: number | null
  },
): Promise<void> {
  await tx.query(
    `UPDATE commerce.order_lines SET status = $2, picked_quantity = $3, actual_weight_lb = $4
     WHERE id = $1`,
    [
      lineId,
      pick.status,
      pick.pickedQuantity,
      pick.actualWeightMlb === null ? null : mlbToLb(pick.actualWeightMlb),
    ],
  )
}

export async function saveFinalAmounts(
  tx: Db,
  orderId: number,
  final: {
    lines: Array<{ lineNo: number; lineTotalCents: number; taxCents: number; depositCents: number }>
    itemSubtotalCents: number
    depositCents: number
    taxCents: number
    totalCents: number
    feeCents: number
  },
): Promise<void> {
  for (const l of final.lines)
    await tx.query(
      `UPDATE commerce.order_lines SET final_line_total_cents = $3, final_tax_cents = $4,
         final_deposit_cents = $5 WHERE order_id = $1 AND line_no = $2`,
      [orderId, l.lineNo, l.lineTotalCents, l.taxCents, l.depositCents],
    )
  await tx.query(
    `UPDATE commerce.orders SET final_item_subtotal_cents = $2, final_deposit_cents = $3,
       final_tax_cents = $4, final_total_cents = $5, fee_final_cents = $6 WHERE id = $1`,
    [
      orderId,
      final.itemSubtotalCents,
      final.depositCents,
      final.taxCents,
      final.totalCents,
      final.feeCents,
    ],
  )
}
