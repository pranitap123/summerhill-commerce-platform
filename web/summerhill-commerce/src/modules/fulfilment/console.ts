import { timingSafeEqual } from 'node:crypto'

import { getPricingProducts, getProductsByIds, getProductsByUpc } from '@/modules/catalog'
import { audit, emit } from '@/modules/ops'
import {
  deleteSubstituteLine,
  getOrder,
  getOrderByPublicId,
  getOrderEvents,
  getOrderForUpdate,
  getOrderLines,
  insertSubstituteLine,
  listOrderIdsForLocations,
  recordLinePick,
  recordOrderEvent,
  resetLinePick,
  STATUS_LABELS,
  transitionInTx,
  type Order,
  type OrderLine,
  type OrderStatus,
} from '@/modules/ordering'
import { getPaymentForOrder, projectCapture, voidOrder } from '@/modules/payments'
import {
  applyBasisPoints,
  divideRoundHalfUp,
  effectivePrice,
  priceForWeight,
  TAX_RATE_BP,
} from '@/modules/pricing'
import { getLocationSettings } from '@/modules/scheduling'
import type { PoolClient } from 'pg'

import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { requireRole, staffActor, type StaffScope } from './access'
import {
  decodeBarcode,
  parseScaleConfig,
  toCatalogCode,
  toGtin13,
  type DecodedBarcode,
} from './barcode'

/**
 * The merchant console's workflow (G4-06…G4-14, ORDERS §5–§7):
 *   placed ─accept→ accepted ─start→ picking ─(line actions)… complete→ picked ─capture job→ ready
 *   ready ─pickup code→ collected
 * Every action checks the caller's scope (404 outside it), locks the order row, re-checks the
 * status, writes the timeline, and emits outbox events for side effects (email, capture).
 */
export const REJECT_REASONS = ['too_busy', 'items_unavailable', 'closing', 'other'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]
export const UNAVAILABLE_REASONS = ['out_of_stock', 'damaged', 'quality', 'other'] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/** Weighed lines outside this band of the estimate need the picker to confirm (ORDERS §6). */
export const WEIGHT_TOLERANCE = { maxRatio: 1.5, minRatio: 0.5 }
export const MAX_LINE_WEIGHT_MLB = 50_000
export const PICKUP_CODE_MAX_FAILURES = 5
/** Orders untouched this long after being placed are escalated, then auto-rejected (ORDERS §5). */
export const ESCALATE_AFTER_MS = 10 * 60_000
export const AUTO_REJECT_AFTER_MS = 15 * 60_000
/** Categories kept in the fridge/freezer until pickup: the console shows a "cold items" badge. */
export const COLD_CATEGORIES = new Set(['Meat & Seafood', 'Dairy & Eggs', 'Prepared Meals'])

// ---------------------------------------------------------------------------------------- views
const lb = (mlb: number | null) => (mlb === null ? null : mlb / 1000)

export interface ConsoleLine {
  id: number
  lineNo: number
  productId: string
  name: string
  category: string | null
  upc: string | null
  image: string | null
  unit: 'ea' | 'lb'
  isWeighed: boolean
  sellBy: 'quantity' | 'weight'
  quantity: number | null
  estimatedWeightLb: number | null
  unitPriceCents: number
  lineTotalCents: number
  taxable: boolean
  cold: boolean
  replacementPreference: 'best_match' | 'specific' | 'refund'
  replacementProducts: Array<{ id: string; name: string; upc: string | null }>
  note: string | null
  status: OrderLine['status']
  pickedQuantity: number | null
  actualWeightLb: number | null
  labelPriceCents: number | null
  scannedCode: string | null
  unavailableReason: string | null
  substitutionReason: string | null
  /** On an original line that was substituted: its substitute. */
  substitute: ConsoleLine | null
  /** On a substitute: the customer's answer. */
  customerDecision: OrderLine['customerDecision']
}

export interface ConsoleOrderSummary {
  publicId: string
  status: OrderStatus
  statusLabel: string
  pickupName: string
  pickupStartsAt: Date | null
  pickupEndsAt: Date | null
  placedAt: Date | null
  acceptedAt: Date | null
  autoRejectAt: Date | null
  itemCount: number
  weighedCount: number
  cold: boolean
  arrivedAt: Date | null
  arrivalNote: string | null
  pickerId: string | null
  pickedByMe: boolean
  pickupLocked: boolean
}

/** First name-ish part of the email when no pickup name was given; never the full address. */
function displayName(order: Order): string {
  return order.pickupName ?? order.email.split('@')[0]
}

function summarize(order: Order, lines: OrderLine[], scope: StaffScope): ConsoleOrderSummary {
  const originals = lines.filter((l) => l.substitutesLineId === null)
  return {
    publicId: order.publicId,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    pickupName: displayName(order),
    pickupStartsAt: order.pickupStartsAt,
    pickupEndsAt: order.pickupEndsAt,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    autoRejectAt:
      order.status === 'placed' && order.placedAt
        ? new Date(order.placedAt.getTime() + AUTO_REJECT_AFTER_MS)
        : null,
    itemCount: originals.length,
    weighedCount: originals.filter((l) => l.isWeighed).length,
    cold: lines.some((l) => l.category !== null && COLD_CATEGORIES.has(l.category)),
    arrivedAt: order.arrivedAt,
    arrivalNote: order.arrivalNote,
    pickerId: order.pickerId,
    pickedByMe: order.pickerId === String(scope.user.id),
    pickupLocked: order.pickupLockedAt !== null,
  }
}

const QUEUE_STATUSES: readonly OrderStatus[] = [
  'placed',
  'accepted',
  'picking',
  'picked',
  'payment_issue',
  'ready',
  'no_show',
]

/** The console queue of one location (G4-06): everything that still needs a person. */
export async function consoleQueue(scope: StaffScope, locationId: number, now = new Date()) {
  const settings = await getLocationSettings(locationId)
  if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Location not found')
  const role = requireRole(scope, settings, 'picker', 'Location not found')
  const db = getDb()
  const ids = await listOrderIdsForLocations(db, [locationId], QUEUE_STATUSES)
  const doneIds = await listOrderIdsForLocations(db, [locationId], ['collected', 'cancelled'], {
    since: new Date(now.getTime() - 12 * 3600_000),
    limit: 30,
  })
  const load = async (id: number) => {
    const order = (await getOrder(id, db))!
    return summarize(order, await getOrderLines(id, db), scope)
  }
  const [active, done] = await Promise.all([
    Promise.all(ids.map(load)),
    Promise.all(doneIds.map(load)),
  ])
  return {
    location: {
      id: settings.locationId,
      name: settings.locationName,
      timeZone: settings.timeZone,
      paused: settings.paused,
      pauseReason: settings.pauseReason,
    },
    role,
    serverTime: now,
    orders: active,
    done,
  }
}

async function loadForStaff(scope: StaffScope, publicId: string, db: Db = getDb()) {
  const order = /^SH-[0-9A-Z]{6}$/.test(publicId) ? await getOrderByPublicId(publicId, db) : null
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
  const role = requireRole(scope, order, 'picker', 'Order not found')
  return { order, role }
}

async function toConsoleLines(lines: OrderLine[]): Promise<ConsoleLine[]> {
  const productIds = new Set(lines.map((l) => l.productId))
  for (const l of lines) l.replacementProductIds.forEach((id) => productIds.add(id))
  const products = new Map((await getProductsByIds([...productIds])).map((p) => [p.id, p]))
  const view = (l: OrderLine): ConsoleLine => ({
    id: l.id,
    lineNo: l.lineNo,
    productId: l.productId,
    name: l.name,
    category: l.category,
    upc: l.upc,
    image: products.get(l.productId)?.images[0] ?? null,
    unit: l.unit,
    isWeighed: l.isWeighed,
    sellBy: l.sellBy,
    quantity: l.quantity,
    estimatedWeightLb: lb(l.estimatedWeightMlb),
    unitPriceCents: l.unitPriceCents,
    lineTotalCents: l.lineTotalCents,
    taxable: l.taxRateBp > 0,
    cold: l.category !== null && COLD_CATEGORIES.has(l.category),
    replacementPreference: l.replacementPreference,
    replacementProducts: l.replacementProductIds.flatMap((id) => {
      const p = products.get(id)
      return p ? [{ id, name: p.name, upc: p.upc }] : []
    }),
    note: l.note,
    status: l.status,
    pickedQuantity: l.pickedQuantity,
    actualWeightLb: lb(l.actualWeightMlb),
    labelPriceCents: l.labelPriceCents,
    scannedCode: l.scannedCode,
    unavailableReason: l.unavailableReason,
    substitutionReason: l.substitutionReason,
    substitute: null,
    customerDecision: l.customerDecision,
  })
  const subs = new Map(
    lines.filter((l) => l.substitutesLineId !== null).map((l) => [l.substitutesLineId!, view(l)]),
  )
  return lines
    .filter((l) => l.substitutesLineId === null)
    .map((l) => ({ ...view(l), substitute: subs.get(l.id) ?? null }))
}

/** Everything the picker's screen needs for one order (G4-08). */
export async function consoleOrder(scope: StaffScope, publicId: string) {
  const { order, role } = await loadForStaff(scope, publicId)
  const [lines, events, payment] = await Promise.all([
    getOrderLines(order.id),
    getOrderEvents(order.id),
    getPaymentForOrder(order.id),
  ])
  const projection = await projectCapture(order, lines, payment)
  return {
    ...summarize(order, lines, scope),
    role,
    lines: await toConsoleLines(lines),
    unresolvedLines: lines.filter((l) => l.substitutesLineId === null && l.status === 'ordered')
      .length,
    money: {
      estimatedTotalCents: order.estimatedTotalCents,
      authorizedCents: payment?.amountAuthorizedCents ?? order.authorizationCents,
      ceilingCents: projection.ceilingCents,
      projectedTotalCents: projection.final.totalCents,
      overCeilingCents: Math.max(0, projection.final.totalCents - projection.ceilingCents),
      finalTotalCents: order.finalTotalCents,
    },
    timeline: events.map((e) => ({
      type: e.type,
      label: e.toStatus ? STATUS_LABELS[e.toStatus as OrderStatus] : e.type.replace(/_/g, ' '),
      actorType: e.actorType,
      reason: e.reason,
      at: e.at,
    })),
  }
}

// ------------------------------------------------------------------------ acceptance (G4-07)
export async function acceptOrder(scope: StaffScope, publicId: string, requestId: string | null) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  await withTransaction(async (tx) => {
    await transitionInTx(tx, order.id, 'placed', 'accepted', actor, { requestId })
    await tx.query(
      'UPDATE commerce.orders SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
      [order.id, actor.id],
    )
  })
  return consoleOrder(scope, publicId)
}

/** Any reject voids the authorisation immediately (ORDERS §5); the customer gets an apology. */
export async function rejectOrder(
  scope: StaffScope,
  publicId: string,
  reason: RejectReason,
  requestId: string | null,
) {
  const { order } = await loadForStaff(scope, publicId)
  if (order.status !== 'placed')
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      `Only new orders can be rejected; this one is ${order.status}. Ask support to cancel it.`,
      { status: order.status },
    )
  await voidOrder(order.id, staffActor(scope), `merchant_rejected:${reason}`, requestId)
  return consoleOrder(scope, publicId)
}

// --------------------------------------------------------------------------- picking (G4-08)
/**
 * Claims the order for the caller. One picker per order: taking over from someone else needs an
 * explicit confirmation (`takeover`), which is recorded on the timeline.
 */
export async function startPicking(
  scope: StaffScope,
  publicId: string,
  opts: { takeover?: boolean; requestId?: string | null } = {},
) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  const me = String(scope.user.id)
  await withTransaction(async (tx) => {
    const current = (await getOrderForUpdate(tx, order.id))!
    if (current.status === 'accepted') {
      await transitionInTx(tx, order.id, 'accepted', 'picking', actor, {
        requestId: opts.requestId,
      })
      await tx.query(
        'UPDATE commerce.orders SET picker_id = $2, pick_started_at = now() WHERE id = $1',
        [order.id, me],
      )
      return
    }
    if (current.status !== 'picking')
      throw new HttpError(409, 'ORDER_STATE_CONFLICT', `Order is ${current.status}`, {
        status: current.status,
      })
    if (current.pickerId === me) return
    if (!opts.takeover)
      throw new HttpError(409, 'PICKER_CONFLICT', 'Another picker is working on this order', {
        pickerId: current.pickerId,
      })
    await tx.query('UPDATE commerce.orders SET picker_id = $2 WHERE id = $1', [order.id, me])
    await recordOrderEvent(tx, order.id, 'pick_takeover', actor, { from: current.pickerId })
  })
  return consoleOrder(scope, publicId)
}

/** Locks the order and checks the caller is its current picker. */
async function lockForPicking(tx: Db, scope: StaffScope, orderId: number): Promise<Order> {
  const order = (await getOrderForUpdate(tx, orderId))!
  if (order.status !== 'picking')
    throw new HttpError(409, 'ORDER_STATE_CONFLICT', `Order is ${order.status}, not being picked`, {
      status: order.status,
    })
  if (order.pickerId !== String(scope.user.id))
    throw new HttpError(409, 'PICKER_CONFLICT', 'Another picker is working on this order', {
      pickerId: order.pickerId,
    })
  return order
}

async function lockLine(tx: Db, orderId: number, lineId: number): Promise<OrderLine> {
  const line = (await getOrderLines(orderId, tx)).find((l) => l.id === lineId)
  if (!line || line.substitutesLineId !== null)
    throw new HttpError(404, 'NOT_FOUND', 'Line not found on this order')
  return line
}

// ------------------------------------------------------------------------ scanning (G4-10/11)
const catalogCodeOf = (upc: string | null) => {
  const gtin = upc ? toGtin13(upc) : null
  return gtin ? toCatalogCode(gtin) : null
}

async function logUnrecognised(db: Db, order: Order, code: string, scope: StaffScope) {
  await db.query(
    `INSERT INTO ops.unrecognised_barcodes (merchant_id, code, order_id, scanned_by)
     VALUES ($1, $2, $3, $4)`,
    [order.merchantId, code.slice(0, 64), order.id, String(scope.user.id)],
  )
}

/**
 * Runs a pick transaction; an unknown barcode is logged after it rolled back (logging inside it
 * would be undone, and from another connection it would wait on the order row the transaction
 * has locked).
 */
async function withScanLog<T>(
  scope: StaffScope,
  order: Order,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(fn)
  } catch (err) {
    if (err instanceof HttpError && err.code === 'UNKNOWN_BARCODE')
      await logUnrecognised(getDb(), order, (err.details as { code: string }).code, scope)
    throw err
  }
}

export type ScanMatch =
  | { match: 'line'; lineId: number; decoded: DecodedBarcode }
  | {
      match: 'replacement'
      lineId: number
      productId: string
      name: string
      decoded: DecodedBarcode
    }
  | { match: 'not_in_order'; productId: string; name: string; decoded: DecodedBarcode }
  | { match: 'unknown'; decoded: DecodedBarcode }
  | { match: 'invalid'; decoded: DecodedBarcode }

/**
 * What a scanned code is, relative to this order: one of its lines, a replacement the customer
 * chose for a line, another product of the store ("wrong item?"), or unknown (logged so the
 * catalogue's UPC gaps can be fixed).
 */
export async function identifyScan(
  scope: StaffScope,
  order: Order,
  code: string,
  db: Db = getDb(),
): Promise<ScanMatch> {
  const settings = await getLocationSettings(order.locationId, db)
  const decoded = decodeBarcode(code, parseScaleConfig(settings?.scaleBarcode))
  if (decoded.kind === 'invalid') return { match: 'invalid', decoded }
  const lines = await getOrderLines(order.id, db)
  const originals = lines.filter((l) => l.substitutesLineId === null)
  const line = originals.find((l) => catalogCodeOf(l.upc) === decoded.catalogCode)
  if (line) return { match: 'line', lineId: line.id, decoded }
  const [product] = await getProductsByUpc(order.merchantId, [decoded.catalogCode])
  if (!product) {
    await logUnrecognised(db, order, code, scope)
    return { match: 'unknown', decoded }
  }
  const wanted = originals.find((l) => l.replacementProductIds.includes(product.id))
  if (wanted)
    return {
      match: 'replacement',
      lineId: wanted.id,
      productId: product.id,
      name: product.name,
      decoded,
    }
  return { match: 'not_in_order', productId: product.id, name: product.name, decoded }
}

export async function scanForOrder(scope: StaffScope, publicId: string, code: string) {
  const { order } = await loadForStaff(scope, publicId)
  const result = await identifyScan(scope, order, code)
  const { decoded, ...rest } = result
  return {
    ...rest,
    kind: decoded.kind,
    priceCents: decoded.kind === 'variable_measure' ? decoded.priceCents : null,
    weightLb: decoded.kind === 'variable_measure' ? lb(decoded.weightMlb) : null,
  }
}

/** Verifies a scan against the product it must be; returns a label's embedded price/weight. */
async function verifyScan(
  tx: Db,
  scope: StaffScope,
  order: Order,
  expectedUpc: string | null,
  code: string,
): Promise<{ labelPriceCents: number | null; labelWeightMlb: number | null }> {
  const settings = await getLocationSettings(order.locationId, tx)
  const decoded = decodeBarcode(code, parseScaleConfig(settings?.scaleBarcode))
  if (decoded.kind === 'invalid')
    throw new HttpError(
      422,
      'INVALID_BARCODE',
      "That barcode didn't read correctly. Scan it again.",
    )
  const expected = catalogCodeOf(expectedUpc)
  if (!expected)
    throw new HttpError(
      422,
      'NO_BARCODE_ON_FILE',
      'This product has no barcode on file. Pick it without scanning.',
    )
  if (decoded.catalogCode !== expected) {
    const [other] = await getProductsByUpc(order.merchantId, [decoded.catalogCode])
    if (!other)
      throw new HttpError(422, 'UNKNOWN_BARCODE', "We don't know this barcode. Check the item.", {
        code,
      })
    throw new HttpError(422, 'WRONG_ITEM', `Wrong item? That's ${other.name}.`, {
      scannedProductId: other.id,
      scannedName: other.name,
    })
  }
  return decoded.kind === 'variable_measure'
    ? { labelPriceCents: decoded.priceCents, labelWeightMlb: decoded.weightMlb }
    : { labelPriceCents: null, labelWeightMlb: null }
}

// ------------------------------------------------------------------------ line actions (G4-09)
export type PickInput =
  | {
      action: 'picked'
      quantity?: number
      weightLb?: number
      scannedCode?: string
      /** The picker confirmed a weight far from the estimate. */
      confirmUnusualWeight?: boolean
    }
  | { action: 'unavailable'; reason: UnavailableReason }
  | { action: 'reset' }

interface WeighInput {
  unitPriceCents: number
  estimatedWeightMlb: number | null
  weightMlb: number | null
  label: { labelPriceCents: number | null; labelWeightMlb: number | null }
  confirmUnusualWeight?: boolean
}

/** Weight of a weighed pick, from a scale label or manual entry, with sanity checks. */
export function resolveWeight(input: WeighInput): {
  weightMlb: number
  labelPriceCents: number | null
} {
  let weightMlb = input.weightMlb
  let labelPriceCents: number | null = null
  if (input.label.labelWeightMlb !== null) weightMlb = input.label.labelWeightMlb
  else if (input.label.labelPriceCents !== null && input.unitPriceCents > 0) {
    labelPriceCents = input.label.labelPriceCents
    weightMlb = divideRoundHalfUp(labelPriceCents * 1000, input.unitPriceCents)
  }
  if (weightMlb === null)
    throw new HttpError(422, 'WEIGHT_REQUIRED', 'Enter the weight or scan the scale label')
  if (weightMlb <= 0 || weightMlb > MAX_LINE_WEIGHT_MLB)
    throw new HttpError(422, 'WEIGHT_INVALID', 'Weight must be between 0 and 50 lb')
  const est = input.estimatedWeightMlb
  if (
    est &&
    !input.confirmUnusualWeight &&
    (weightMlb > est * WEIGHT_TOLERANCE.maxRatio || weightMlb < est * WEIGHT_TOLERANCE.minRatio)
  )
    throw new HttpError(
      422,
      'WEIGHT_CONFIRMATION_REQUIRED',
      `That's ${(weightMlb / 1000).toFixed(2)} lb against an estimate of ${(est / 1000).toFixed(2)} lb. Confirm the weight?`,
      { weightLb: weightMlb / 1000, estimatedWeightLb: est / 1000 },
    )
  return { weightMlb, labelPriceCents }
}

export async function pickLine(
  scope: StaffScope,
  publicId: string,
  lineId: number,
  input: PickInput,
) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  let suggestOutOfStock: { productId: string; name: string } | null = null
  await withScanLog(scope, order, async (tx) => {
    await lockForPicking(tx, scope, order.id)
    const line = await lockLine(tx, order.id, lineId)
    if (input.action === 'reset') {
      await deleteSubstituteLine(tx, line.id)
      await resetLinePick(tx, line.id)
      await recordOrderEvent(tx, order.id, 'line_reset', actor, { lineNo: line.lineNo })
      return
    }
    if (line.status === 'substituted')
      throw new HttpError(409, 'LINE_SUBSTITUTED', 'Undo the replacement first')
    if (input.action === 'unavailable') {
      await recordLinePick(tx, line.id, {
        status: 'unavailable',
        pickedQuantity: 0,
        actualWeightMlb: null,
        unavailableReason: input.reason,
        pickedBy: actor.id,
      })
      await recordOrderEvent(
        tx,
        order.id,
        'line_unavailable',
        actor,
        { lineNo: line.lineNo },
        input.reason,
      )
      if (input.reason === 'out_of_stock')
        suggestOutOfStock = { productId: line.productId, name: line.name }
      return
    }
    const ordered = line.quantity ?? 1
    const pickedQuantity = line.sellBy === 'weight' ? null : (input.quantity ?? ordered)
    if (pickedQuantity !== null && (pickedQuantity < 1 || pickedQuantity > ordered))
      throw new HttpError(
        422,
        'QUANTITY_INVALID',
        `Pick between 1 and ${ordered}; mark the line unavailable if there are none`,
      )
    const label = input.scannedCode
      ? await verifyScan(tx, scope, order, line.upc, input.scannedCode)
      : { labelPriceCents: null, labelWeightMlb: null }
    let actualWeightMlb: number | null = null
    let labelPriceCents: number | null = null
    if (line.isWeighed) {
      const est =
        line.estimatedWeightMlb === null
          ? null
          : pickedQuantity === null
            ? line.estimatedWeightMlb
            : Math.round((line.estimatedWeightMlb * pickedQuantity) / ordered)
      ;({ weightMlb: actualWeightMlb, labelPriceCents } = resolveWeight({
        unitPriceCents: line.unitPriceCents,
        estimatedWeightMlb: est,
        weightMlb: input.weightLb === undefined ? null : Math.round(input.weightLb * 1000),
        label,
        confirmUnusualWeight: input.confirmUnusualWeight,
      }))
    }
    await recordLinePick(tx, line.id, {
      status: 'picked',
      pickedQuantity,
      actualWeightMlb,
      labelPriceCents,
      scannedCode: input.scannedCode ?? null,
      pickedBy: actor.id,
    })
    await recordOrderEvent(tx, order.id, 'line_picked', actor, {
      lineNo: line.lineNo,
      pickedQuantity,
      actualWeightLb: lb(actualWeightMlb),
      scanned: Boolean(input.scannedCode),
    })
  })
  return { order: await consoleOrder(scope, publicId), suggestOutOfStock }
}

// ------------------------------------------------------------------- substitutions (G4-12)
export interface SubstituteInput {
  productId: string
  quantity?: number
  weightLb?: number
  scannedCode?: string
  reason?: string
  confirmUnusualWeight?: boolean
}

/**
 * Replaces an unavailable item (ORDERS §6). Allowed only when the customer didn't choose
 * "refund"; with "specific", only one of the customer's chosen products. The customer pays the
 * LOWER of the original estimate and the substitute's price, and the substitute can't cost more
 * in total (with tax and deposit) than the original line. The customer is told immediately and
 * can reject it until picking completes.
 */
export async function substituteLine(
  scope: StaffScope,
  publicId: string,
  lineId: number,
  input: SubstituteInput,
) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  const [pricing] = await getPricingProducts([input.productId])
  const [summary] = await getProductsByIds([input.productId])
  await withScanLog(scope, order, async (tx) => {
    await lockForPicking(tx, scope, order.id)
    const line = await lockLine(tx, order.id, lineId)
    if (line.replacementPreference === 'refund')
      throw new HttpError(
        422,
        'SUBSTITUTION_NOT_ALLOWED',
        'The customer asked for a refund instead',
      )
    if (
      line.replacementPreference === 'specific' &&
      !line.replacementProductIds.includes(input.productId)
    )
      throw new HttpError(
        422,
        'SUBSTITUTION_NOT_ALLOWED',
        "The customer chose specific replacements; this isn't one of them",
      )
    if (
      !pricing ||
      !summary ||
      pricing.merchantId !== order.merchantId ||
      input.productId === line.productId ||
      !pricing.available
    )
      throw new HttpError(
        422,
        'SUBSTITUTE_INVALID',
        'Choose another in-stock product from this store',
      )

    const isWeighed = pricing.pricingModel === 'per_weight'
    const unitPriceCents = effectivePrice(pricing, new Date()).unitPriceCents
    const sellByWeight = isWeighed && pricing.sellBy === 'weight'
    const quantity = sellByWeight ? null : (input.quantity ?? line.quantity ?? 1)
    if (quantity !== null && (quantity < 1 || quantity > 99))
      throw new HttpError(422, 'QUANTITY_INVALID', 'Quantity must be between 1 and 99')
    const label = input.scannedCode
      ? await verifyScan(tx, scope, order, summary.upc, input.scannedCode)
      : { labelPriceCents: null, labelWeightMlb: null }
    let weightMlb: number | null = null
    let labelPriceCents: number | null = null
    let lineTotalCents: number
    if (isWeighed) {
      ;({ weightMlb, labelPriceCents } = resolveWeight({
        unitPriceCents,
        estimatedWeightMlb: line.isWeighed ? line.estimatedWeightMlb : null,
        weightMlb: input.weightLb === undefined ? null : Math.round(input.weightLb * 1000),
        label,
        confirmUnusualWeight: input.confirmUnusualWeight,
      }))
      lineTotalCents = labelPriceCents ?? priceForWeight(unitPriceCents, weightMlb)
    } else lineTotalCents = quantity! * unitPriceCents
    const taxRateBp = TAX_RATE_BP[pricing.taxCode]

    // "Never pay more": what the customer pays for the substitute, all in, must not exceed the
    // original line all in (a zero-rated item replaced by a taxable one could, even when capped).
    const charged = Math.min(lineTotalCents, line.lineTotalCents)
    const subAllIn =
      charged + applyBasisPoints(charged, taxRateBp) + pricing.depositCents * (quantity ?? 1)
    const origAllIn = line.lineTotalCents + line.taxCents + line.depositCents
    if (subAllIn > origAllIn)
      throw new HttpError(
        422,
        'SUBSTITUTE_COSTS_MORE',
        'With tax and deposit this replacement would cost the customer more. Choose another.',
        { substituteCents: subAllIn, originalCents: origAllIn },
      )

    await deleteSubstituteLine(tx, line.id)
    await resetLinePick(tx, line.id)
    const subId = await insertSubstituteLine(
      tx,
      line,
      order.id,
      {
        productId: pricing.id,
        name: pricing.name,
        pricingModel: pricing.pricingModel,
        sellBy: pricing.sellBy,
        unit: isWeighed ? 'lb' : 'ea',
        regularUnitPriceCents: pricing.unitPriceCents,
        unitPriceCents,
        promoLabel: effectivePrice(pricing, new Date()).promoLabel,
        isWeighed,
        taxCode: pricing.taxCode,
        taxRateBp,
        depositCentsPerUnit: pricing.depositCents,
        upc: summary.upc,
        category: summary.category,
      },
      {
        quantity,
        weightMlb,
        lineTotalCents,
        taxCents: applyBasisPoints(lineTotalCents, taxRateBp),
        labelPriceCents,
        scannedCode: input.scannedCode ?? null,
        reason: input.reason ?? null,
        pickedBy: String(scope.user.id),
      },
    )
    await recordOrderEvent(tx, order.id, 'line_substituted', actor, {
      lineNo: line.lineNo,
      substituteProductId: pricing.id,
      substituteName: pricing.name,
    })
    await emit(tx, 'order.line_substituted', order.id, {
      orderId: order.id,
      publicId: order.publicId,
      lineId: line.id,
      substituteLineId: subId,
    })
  })
  return consoleOrder(scope, publicId)
}

// ------------------------------------------------------------------ complete picking (G4-13)
/**
 * Picking done → `picked`; the outbox event starts the capture job, which charges exactly the
 * final amount and moves the order to `ready`. Refused while lines are unresolved. When the final
 * total would exceed what the card can be charged (the authorisation, or the overcapture maximum)
 * the picker must confirm (ORDERS §6: trim the item, or the platform absorbs the difference).
 * Substitutes the customer hasn't answered count as approved ("no answer → the preference applies").
 */
export async function completePicking(
  scope: StaffScope,
  publicId: string,
  opts: { confirmOverAuthorization?: boolean; requestId?: string | null } = {},
) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  await withTransaction(async (tx) => {
    const locked = await lockForPicking(tx, scope, order.id)
    const lines = await getOrderLines(order.id, tx)
    const open = lines.filter((l) => l.substitutesLineId === null && l.status === 'ordered')
    if (open.length)
      throw new HttpError(422, 'LINES_NOT_PICKED', `${open.length} item(s) still to pick`, {
        lineNos: open.map((l) => l.lineNo),
      })
    const payment = await getPaymentForOrder(order.id, tx)
    const { final, ceilingCents } = await projectCapture(locked, lines, payment)
    if (final.totalCents > ceilingCents && !opts.confirmOverAuthorization)
      throw new HttpError(
        422,
        'OVER_AUTHORIZATION',
        `The final total ${(final.totalCents / 100).toFixed(2)} is more than the card hold allows (${(ceilingCents / 100).toFixed(2)}). Reduce a weighed item, or confirm to absorb the difference.`,
        {
          finalTotalCents: final.totalCents,
          ceilingCents,
          overByCents: final.totalCents - ceilingCents,
        },
      )
    const pending = await tx.query<{ id: string }>(
      `UPDATE commerce.order_lines SET customer_decision = 'approved', customer_decided_at = now()
       WHERE order_id = $1 AND customer_decision = 'pending' RETURNING id`,
      [order.id],
    )
    if (pending.rowCount)
      await recordOrderEvent(tx, order.id, 'substitutions_auto_approved', actor, {
        count: pending.rowCount,
      })
    await tx.query('UPDATE commerce.orders SET pick_completed_at = now() WHERE id = $1', [order.id])
    await transitionInTx(tx, order.id, 'picking', 'picked', actor, {
      requestId: opts.requestId,
      data: {
        projectedTotalCents: final.totalCents,
        ...(final.totalCents > ceilingCents
          ? { absorbedCents: final.totalCents - ceilingCents }
          : {}),
      },
    })
  })
  return consoleOrder(scope, publicId)
}

// ------------------------------------------------------------------------- handover (G4-14)
/** Constant-time comparison, so response timing can't reveal how many digits were right. */
function sameCode(given: string, expected: string): boolean {
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
}

/**
 * The customer tells the code; staff type it (ORDERS §7). Five wrong codes lock the order until a
 * manager unlocks it. The handover records who handed it over.
 */
export async function handOver(
  scope: StaffScope,
  publicId: string,
  code: string,
  requestId: string | null,
) {
  const { order } = await loadForStaff(scope, publicId)
  const actor = staffActor(scope)
  const outcome = await withTransaction(async (tx) => {
    const current = (await getOrderForUpdate(tx, order.id))!
    if (current.status !== 'ready' && current.status !== 'no_show')
      throw new HttpError(
        409,
        'ORDER_STATE_CONFLICT',
        `Order is ${current.status}, not ready for pickup`,
        {
          status: current.status,
        },
      )
    if (current.pickupLockedAt)
      throw new HttpError(
        423,
        'PICKUP_LOCKED',
        'Too many wrong codes. A manager must unlock this order.',
      )
    if (!current.pickupCode || !sameCode(code, current.pickupCode)) {
      const failures = current.pickupCodeFailures + 1
      const lock = failures >= PICKUP_CODE_MAX_FAILURES
      await tx.query(
        `UPDATE commerce.orders SET pickup_code_failures = $2,
           pickup_locked_at = CASE WHEN $3 THEN now() ELSE pickup_locked_at END WHERE id = $1`,
        [order.id, failures, lock],
      )
      await recordOrderEvent(tx, order.id, lock ? 'handover_locked' : 'handover_failed', actor, {
        failures,
      })
      return { ok: false as const, attemptsLeft: PICKUP_CODE_MAX_FAILURES - failures }
    }
    await transitionInTx(tx, order.id, current.status, 'collected', actor, {
      requestId,
      data: { handedOverBy: actor.id },
    })
    await tx.query(
      'UPDATE commerce.orders SET collected_at = now(), handed_over_by = $2 WHERE id = $1',
      [order.id, actor.id],
    )
    return { ok: true as const }
  })
  // Recorded outside the rolled-back path so the failure counter sticks.
  if (!outcome.ok)
    throw new HttpError(
      outcome.attemptsLeft > 0 ? 422 : 423,
      outcome.attemptsLeft > 0 ? 'WRONG_PICKUP_CODE' : 'PICKUP_LOCKED',
      outcome.attemptsLeft > 0
        ? `Wrong code. ${outcome.attemptsLeft} attempt(s) left.`
        : 'Too many wrong codes. A manager must unlock this order.',
      { attemptsLeft: Math.max(0, outcome.attemptsLeft) },
    )
  return consoleOrder(scope, publicId)
}

export async function unlockHandover(
  scope: StaffScope,
  publicId: string,
  requestId: string | null,
) {
  const { order } = await loadForStaff(scope, publicId)
  requireRole(scope, order, 'manager')
  const actor = staffActor(scope)
  await withTransaction(async (tx) => {
    await tx.query(
      'UPDATE commerce.orders SET pickup_code_failures = 0, pickup_locked_at = NULL WHERE id = $1',
      [order.id],
    )
    await recordOrderEvent(tx, order.id, 'handover_unlocked', actor)
    await audit(tx, {
      actor,
      action: 'order.handover.unlock',
      targetType: 'order',
      targetId: order.id,
      requestId,
    })
  })
  return consoleOrder(scope, publicId)
}
