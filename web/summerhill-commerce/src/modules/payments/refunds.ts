import { emit, raiseAlert, type AuditContext, audit } from '@/modules/ops'
import {
  getOrder,
  getOrderForUpdate,
  getOrderLines,
  recordOrderEvent,
  transitionInTx,
  VOIDABLE_STATUSES,
  type Order,
  type OrderLine,
} from '@/modules/ordering'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { getLogger } from '@/server/logger'

import { voidOrder } from './capture'
import { getGateway, type RefundInfo } from './gateway'
import { postJournal } from './ledger'
import { postRefund, reverseEntries, type LedgerEntry } from './ledgerRules'
import {
  hstShareOfFeeRefund,
  lineFullCents,
  lineRefundCents,
  splitShares,
  type RefundableLine,
} from './refundMath'
import { getPaymentForOrder, type Payment } from './repository'

/**
 * Refunds after capture (G5-04, PAYMENTS §6) with the liability matrix (ORDERS §9).
 *
 * The scenario decides who pays; staff don't pick the liability for scenarios the matrix covers.
 * Stripe calls, per liability:
 *   merchant  refund { reverse_transfer, refund_application_fee }: the merchant gives back the
 *             amount and gets the commission on it back
 *   platform  refund {}: the platform pays from its balance
 *   split     refund {} + transfer reversal of the merchant's share (with its fee refund)
 * Flow: (1) a `pending` refund row is committed (one refund at a time per order), (2) Stripe, with
 * idempotency keys derived from the row id, (3) the row, a balanced ledger journal, the order's
 * refund status and an `order.refunded` event commit together. A refund Stripe reports as pending
 * is finished by the `refund.updated` webhook; one that fails later is reversed in the ledger.
 */
export const REFUND_SCENARIOS = {
  missing_item: { liability: 'merchant', label: 'Item missing from the bag (picker error)' },
  wrong_substitute: { liability: 'merchant', label: 'Wrong or unacceptable substitute' },
  damaged: { liability: 'merchant', label: 'Damaged or spoiled item' },
  quality: { liability: 'merchant', label: 'Quality problem' },
  price_error: { liability: 'platform', label: 'Price displayed wrong (our bug): the difference' },
  goodwill: { liability: 'chosen', label: 'Goodwill gesture (liability chosen by staff)' },
  cancellation: { liability: 'chosen', label: 'Order cancelled after it was charged' },
} as const
export type RefundScenario = keyof typeof REFUND_SCENARIOS

/** Matrix rows where the customer gets nothing back (ORDERS §9). */
export const NON_REFUNDABLE_SCENARIOS = {
  changed_mind: 'Customer changed their mind after collection: perishables are not refundable',
  no_show: 'No-show: the customer bears the cost (pickup policy)',
} as const

export type Liability = 'merchant' | 'platform' | 'split'

export interface RefundRequest {
  orderId: number
  scenario: RefundScenario
  /** Line refunds (missing, damaged, …): whole lines or part of a line. */
  lines?: Array<{ lineId: number; quantity?: number; weightMlb?: number }>
  /** An amount instead of lines (price difference, goodwill). */
  amountCents?: number
  /** Everything not yet refunded. */
  full?: boolean
  /** Only for scenarios whose liability is chosen (goodwill, cancellation). */
  liability?: Liability
  merchantShareCents?: number
  reason: string
  source?: 'admin' | 'support_issue' | 'cancellation'
  issueId?: number | null
  /** Cumulative per-order cap for the caller's role (support: $50), or null for no cap. */
  limitCents?: number | null
}

export interface Refund {
  id: number
  orderId: number
  paymentId: number
  amountCents: number
  liability: Liability
  scenario: RefundScenario
  source: string
  merchantCents: number
  platformCents: number
  feeRefundCents: number | null
  lines: Array<{ lineId: number; quantity?: number; weightMlb?: number; amountCents: number }>
  reason: string
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  stripeRefundId: string | null
  stripeTransferReversalId: string | null
  failureReason: string | null
  issueId: number | null
  createdBy: string
  createdAt: Date
  succeededAt: Date | null
}

type Row = Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
function toRefund(r: Row): Refund {
  return {
    id: Number(r.id),
    orderId: Number(r.order_id),
    paymentId: Number(r.payment_id),
    amountCents: Number(r.amount_cents),
    liability: r.liability as Liability,
    scenario: r.scenario as RefundScenario,
    source: String(r.source),
    merchantCents: Number(r.merchant_cents),
    platformCents: Number(r.platform_cents),
    feeRefundCents: n(r.fee_refund_cents),
    lines: r.lines as Refund['lines'],
    reason: String(r.reason),
    status: r.status as Refund['status'],
    stripeRefundId: (r.stripe_refund_id as string) ?? null,
    stripeTransferReversalId: (r.stripe_transfer_reversal_id as string) ?? null,
    failureReason: (r.failure_reason as string) ?? null,
    issueId: n(r.issue_id),
    createdBy: String(r.created_by),
    createdAt: r.created_at as Date,
    succeededAt: (r.succeeded_at as Date) ?? null,
  }
}

export async function listRefundsForOrder(orderId: number, db: Db = getDb()): Promise<Refund[]> {
  const { rows } = await db.query('SELECT * FROM finance.refunds WHERE order_id = $1 ORDER BY id', [
    orderId,
  ])
  return rows.map(toRefund)
}

export async function getRefund(id: number, db: Db = getDb()): Promise<Refund | null> {
  const { rows } = await db.query('SELECT * FROM finance.refunds WHERE id = $1', [id])
  return rows[0] ? toRefund(rows[0]) : null
}

/** Refunds that count against the captured amount (pending ones included). */
const live = (r: Refund) => r.status === 'pending' || r.status === 'succeeded'

function refundableLine(l: OrderLine): RefundableLine {
  return {
    id: l.id,
    isWeighed: l.isWeighed,
    finalLineTotalCents: l.finalLineTotalCents ?? 0,
    finalTaxCents: l.finalTaxCents ?? 0,
    finalDepositCents: l.finalDepositCents ?? 0,
    paidUnits: l.isWeighed ? 1 : (l.pickedQuantity ?? l.quantity ?? 1),
    paidWeightMlb: l.isWeighed ? l.actualWeightMlb : null,
  }
}

/** What the refund dialog shows: per line, what was paid and what is left to refund. */
export async function refundableSummary(orderId: number): Promise<{
  capturedCents: number
  refundedCents: number
  remainingCents: number
  lines: Array<{ lineId: number; name: string; paidCents: number; remainingCents: number }>
}> {
  const payment = await getPaymentForOrder(orderId)
  const refunds = (await listRefundsForOrder(orderId)).filter(live)
  const captured = payment?.status === 'captured' ? (payment.amountCapturedCents ?? 0) : 0
  const refunded = refunds.reduce((s, r) => s + r.amountCents, 0)
  const lines = (await getOrderLines(orderId))
    .filter((l) => (l.finalLineTotalCents ?? 0) > 0)
    .map((l) => {
      const paid = lineFullCents(refundableLine(l))
      const done = refundedOnLine(refunds, l.id)
      return { lineId: l.id, name: l.name, paidCents: paid, remainingCents: paid - done }
    })
  return {
    capturedCents: captured,
    refundedCents: refunded,
    remainingCents: captured - refunded,
    lines,
  }
}

function refundedOnLine(refunds: Refund[], lineId: number): number {
  return refunds.reduce(
    (s, r) => s + r.lines.filter((l) => l.lineId === lineId).reduce((a, l) => a + l.amountCents, 0),
    0,
  )
}

interface Plan {
  amountCents: number
  lines: Refund['lines']
  liability: Liability
  merchantCents: number
  platformCents: number
}

function plan(
  req: RefundRequest,
  order: Order,
  payment: Payment,
  orderLines: OrderLine[],
  previous: Refund[],
): Plan {
  if (req.scenario in NON_REFUNDABLE_SCENARIOS)
    throw new HttpError(422, 'NOT_REFUNDABLE', 'This case is not refundable')
  const scenario = REFUND_SCENARIOS[req.scenario]
  if (!scenario) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown refund scenario')
  const captured = payment.amountCapturedCents ?? 0
  const remaining = captured - previous.reduce((s, r) => s + r.amountCents, 0)
  const modes = [req.lines?.length ? 1 : 0, req.amountCents !== undefined ? 1 : 0, req.full ? 1 : 0]
  if (modes.reduce((a, b) => a + b, 0) !== 1)
    throw new HttpError(400, 'VALIDATION_FAILED', 'Give exactly one of lines, amountCents or full')

  let amountCents: number
  let lines: Refund['lines'] = []
  if (req.lines?.length) {
    const byId = new Map(orderLines.map((l) => [l.id, l]))
    lines = req.lines.map((part) => {
      const line = byId.get(part.lineId)
      if (!line)
        throw new HttpError(422, 'LINE_NOT_FOUND', `Line ${part.lineId} is not on this order`)
      let cents: number
      try {
        cents = lineRefundCents(refundableLine(line), part)
      } catch (err) {
        throw new HttpError(422, 'LINE_REFUND_INVALID', (err as Error).message)
      }
      const left = lineFullCents(refundableLine(line)) - refundedOnLine(previous, line.id)
      if (cents === 0 || cents > left)
        throw new HttpError(
          422,
          'LINE_ALREADY_REFUNDED',
          `${line.name}: only ${left}¢ is left to refund`,
        )
      return { ...part, amountCents: cents }
    })
    amountCents = lines.reduce((s, l) => s + l.amountCents, 0)
  } else if (req.full) amountCents = remaining
  else amountCents = req.amountCents!

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new HttpError(422, 'NOTHING_TO_REFUND', 'Nothing is left to refund on this order')
  if (amountCents > remaining)
    throw new HttpError(
      422,
      'REFUND_EXCEEDS_CAPTURED',
      `Only ${remaining}¢ can still be refunded`,
      {
        remainingCents: remaining,
      },
    )
  if (req.limitCents !== null && req.limitCents !== undefined) {
    const already = previous.reduce((s, r) => s + r.amountCents, 0)
    if (already + amountCents > req.limitCents)
      throw new HttpError(
        403,
        'REFUND_LIMIT',
        'Refunds above your limit need finance or an admin',
        {
          limitCents: req.limitCents,
          alreadyRefundedCents: already,
        },
      )
  }

  let liability: Liability
  if (scenario.liability === 'chosen') {
    if (!req.liability)
      throw new HttpError(400, 'VALIDATION_FAILED', 'Choose who bears this refund (liability)')
    liability = req.liability
  } else {
    if (req.liability && req.liability !== scenario.liability)
      throw new HttpError(
        422,
        'LIABILITY_FIXED',
        `The liability matrix assigns this case to the ${scenario.liability}`,
      )
    liability = scenario.liability
  }
  let shares: { merchantCents: number; platformCents: number }
  try {
    shares = splitShares(liability, amountCents, req.merchantShareCents)
  } catch (err) {
    throw new HttpError(422, 'SPLIT_INVALID', (err as Error).message)
  }
  if (order.merchantId <= 0) throw new Error('order without merchant')
  return { amountCents, lines, liability, ...shares }
}

/** Creates and executes a refund. */
export async function createRefund(ctx: AuditContext, req: RefundRequest): Promise<Refund> {
  const created = await withTransaction(async (tx) => {
    const order = await getOrderForUpdate(tx, req.orderId)
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
    const payment = await getPaymentForOrder(order.id, tx)
    if (!payment || payment.status !== 'captured' || !payment.paymentIntentId) {
      if (VOIDABLE_STATUSES.includes(order.status))
        throw new HttpError(
          409,
          'NOT_CAPTURED',
          'Nothing was charged yet: cancel the order instead (the card hold is released)',
        )
      throw new HttpError(409, 'NOT_CAPTURED', 'This order has no captured payment')
    }
    const previous = (await listRefundsForOrder(order.id, tx)).filter(live)
    if (previous.some((r) => r.status === 'pending'))
      throw new HttpError(
        409,
        'REFUND_IN_PROGRESS',
        'Another refund on this order is still being processed',
      )
    const p = plan(req, order, payment, await getOrderLines(order.id, tx), previous)
    const { rows } = await tx.query(
      `INSERT INTO finance.refunds (payment_id, order_id, amount_cents, liability, reverse_transfer,
         refund_application_fee, allocation, reason, created_by, scenario, source, merchant_cents,
         platform_cents, lines, issue_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        payment.id,
        order.id,
        p.amountCents,
        p.liability,
        p.merchantCents > 0,
        p.merchantCents > 0,
        { merchantCents: p.merchantCents, platformCents: p.platformCents },
        req.reason,
        ctx.actor.id ?? ctx.actor.type,
        req.scenario,
        req.source ?? 'admin',
        p.merchantCents,
        p.platformCents,
        JSON.stringify(p.lines),
        req.issueId ?? null,
      ],
    )
    await audit(tx, {
      ...ctx,
      action: 'refund.create',
      targetType: 'order',
      targetId: order.id,
      data: {
        refundId: Number(rows[0].id),
        amountCents: p.amountCents,
        scenario: req.scenario,
        liability: p.liability,
        merchantCents: p.merchantCents,
        platformCents: p.platformCents,
        lines: p.lines,
        reason: req.reason,
      },
    })
    return { refund: toRefund(rows[0]), payment }
  })
  return executeRefund(created.refund, created.payment)
}

async function executeRefund(refund: Refund, payment: Payment): Promise<Refund> {
  const gateway = getGateway()
  const metadata = {
    refund_id: String(refund.id),
    order_id: String(refund.orderId),
    liability: refund.liability,
  }
  let info: RefundInfo
  let reversalId: string | null = null
  let feeTotal: number | null
  try {
    info = await gateway.refund(
      {
        paymentIntentId: payment.paymentIntentId!,
        amountCents: refund.amountCents,
        reverseTransfer: refund.liability === 'merchant',
        refundApplicationFee: refund.liability === 'merchant',
        metadata,
      },
      `refund:${refund.id}`,
    )
    feeTotal = info.applicationFeeRefundedTotalCents
    reversalId = info.transferReversalId
    if (refund.liability === 'split') {
      const reversal = await gateway.reverseTransfer(
        {
          chargeId: payment.chargeId!,
          amountCents: refund.merchantCents,
          refundApplicationFee: true,
          metadata,
        },
        `refund-reversal:${refund.id}`,
      )
      reversalId = reversal.id
      feeTotal = reversal.applicationFeeRefundedTotalCents
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await getDb().query(
      `UPDATE finance.refunds SET status = 'failed', failure_reason = $2 WHERE id = $1`,
      [refund.id, message.slice(0, 500)],
    )
    getLogger().error({ err, refundId: refund.id }, 'refund failed at the payment provider')
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider refused the refund', {
      message,
    })
  }

  const feeRefund =
    refund.merchantCents > 0 && feeTotal !== null
      ? feeTotal - (await feeRefundedBefore(payment.id, refund.id))
      : 0
  await getDb().query(
    `UPDATE finance.refunds SET stripe_refund_id = $2, stripe_transfer_reversal_id = $3,
       fee_refund_cents = $4 WHERE id = $1`,
    [refund.id, info.id, reversalId, feeRefund],
  )
  if (info.status === 'succeeded') await finalizeRefund(refund.id)
  else if (info.status === 'failed' || info.status === 'canceled')
    await failRefund(refund.id, info.failureReason ?? info.status)
  return (await getRefund(refund.id))!
}

async function feeRefundedBefore(paymentId: number, exceptRefundId: number): Promise<number> {
  const { rows } = await getDb().query<{ total: string }>(
    `SELECT COALESCE(sum(fee_refund_cents), 0) AS total FROM finance.refunds
     WHERE payment_id = $1 AND id <> $2 AND status IN ('pending', 'succeeded')`,
    [paymentId, exceptRefundId],
  )
  return Number(rows[0].total)
}

async function refundEntries(tx: Db, refund: Refund): Promise<LedgerEntry[]> {
  const order = (await getOrder(refund.orderId, tx))!
  const payment = (await getPaymentForOrder(refund.orderId, tx))!
  const { rows } = await tx.query<{ hst: string }>(
    `SELECT COALESCE(sum(e.credit_cents), 0) AS hst FROM finance.ledger_entries e
     JOIN finance.ledger_journals j ON j.id = e.journal_id
     WHERE j.idempotency_key = $1 AND e.account = 'hst_on_commission_payable'`,
    [`capture:${refund.orderId}`],
  )
  const fee = refund.feeRefundCents ?? 0
  return postRefund({
    merchantId: order.merchantId,
    merchantCents: refund.merchantCents,
    platformCents: refund.platformCents,
    feeRefundCents: fee,
    hstOnFeeRefundCents: hstShareOfFeeRefund(
      fee,
      payment.applicationFeeCents ?? 0,
      Number(rows[0].hst),
    ),
  })
}

/** Stripe confirmed the refund: ledger, order refund status, timeline, customer email. */
export async function finalizeRefund(refundId: number): Promise<'finalized' | 'already'> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE finance.refunds SET status = 'succeeded', succeeded_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [refundId],
    )
    if (!rows[0]) return 'already' as const
    const refund = toRefund(rows[0])
    await getOrderForUpdate(tx, refund.orderId)
    await postJournal(tx, {
      key: `refund:${refund.id}`,
      event: 'refund',
      orderId: refund.orderId,
      externalRef: refund.stripeRefundId,
      entries: await refundEntries(tx, refund),
    })
    await updateRefundStatus(tx, refund.orderId)
    await recordOrderEvent(
      tx,
      refund.orderId,
      'refunded',
      { type: 'system', id: null },
      {
        refundId: refund.id,
        amountCents: refund.amountCents,
        liability: refund.liability,
        scenario: refund.scenario,
        lines: refund.lines,
      },
      refund.reason,
    )
    await emit(tx, 'order.refunded', refund.orderId, {
      orderId: refund.orderId,
      refundId: refund.id,
      amountCents: refund.amountCents,
    })
    return 'finalized' as const
  })
}

/** Stripe reports the refund failed: status, reversing journal if it was posted, alert. */
export async function failRefund(refundId: number, reason: string): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await getRefund(refundId, tx)
    if (!before || before.status === 'failed' || before.status === 'canceled') return
    await tx.query(
      `UPDATE finance.refunds SET status = 'failed', failure_reason = $2 WHERE id = $1`,
      [refundId, reason.slice(0, 500)],
    )
    if (before.status === 'succeeded') {
      await postJournal(tx, {
        key: `refund-failed:${refundId}`,
        event: 'refund_failed',
        orderId: before.orderId,
        externalRef: before.stripeRefundId,
        entries: reverseEntries(await refundEntries(tx, before)),
      })
      await updateRefundStatus(tx, before.orderId)
    }
    await raiseAlert(tx, {
      kind: 'refund.failed',
      dedupeKey: `refund-failed:${refundId}`,
      severity: 'critical',
      message: `Refund ${refundId} on order ${before.orderId} failed: ${reason}`,
      data: { refundId, orderId: before.orderId, reason },
    })
  })
}

async function updateRefundStatus(tx: Db, orderId: number): Promise<void> {
  await tx.query(
    `UPDATE commerce.orders o SET refund_status = CASE
       WHEN r.total = 0 THEN 'none' WHEN r.total >= p.captured THEN 'full' ELSE 'partial' END
     FROM (SELECT COALESCE(sum(amount_cents), 0) AS total FROM finance.refunds
           WHERE order_id = $1 AND status = 'succeeded') r,
          (SELECT COALESCE(max(amount_captured_cents), 0) AS captured FROM finance.payments
           WHERE order_id = $1 AND status = 'captured') p
     WHERE o.id = $1`,
    [orderId],
  )
}

/** Webhook: refund.updated / refund.failed / charge.refund.updated. */
export async function onRefundEvent(refund: {
  id: string
  status: string | null
  failure_reason?: string | null
}): Promise<'processed' | 'ignored'> {
  const { rows } = await getDb().query<{ id: string }>(
    'SELECT id FROM finance.refunds WHERE stripe_refund_id = $1',
    [refund.id],
  )
  if (!rows[0]) return 'ignored'
  const id = Number(rows[0].id)
  if (refund.status === 'succeeded') await finalizeRefund(id)
  else if (refund.status === 'failed' || refund.status === 'canceled')
    await failRefund(id, refund.failure_reason ?? refund.status)
  else return 'ignored'
  return 'processed'
}

/**
 * Cancel on behalf (A7, ORDERS §8): before capture the card hold is released (void); an order
 * that was charged but not collected is refunded in full and cancelled.
 */
export async function cancelOnBehalf(
  ctx: AuditContext,
  orderId: number,
  input: { reason: string; liability?: Liability; limitCents?: number | null },
): Promise<{ order: Order; refund: Refund | null }> {
  const order = await getOrder(orderId)
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
  if (order.status === 'pending_payment' || VOIDABLE_STATUSES.includes(order.status)) {
    const voided = await voidOrder(orderId, ctx.actor, input.reason, ctx.requestId ?? null)
    await audit(getDb(), {
      ...ctx,
      action: 'order.cancel',
      targetType: 'order',
      targetId: orderId,
      data: { reason: input.reason, money: 'void', status: voided.status },
    })
    return { order: voided, refund: null }
  }
  if (order.status !== 'ready')
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      `An order that is ${order.status} can't be cancelled; refund it instead`,
    )
  const refund = await createRefund(ctx, {
    orderId,
    scenario: 'cancellation',
    full: true,
    liability: input.liability,
    reason: input.reason,
    source: 'cancellation',
    limitCents: input.limitCents,
  })
  if (refund.status === 'failed')
    throw new HttpError(
      502,
      'PAYMENT_PROVIDER_ERROR',
      'The refund failed; the order was not cancelled',
    )
  await withTransaction(async (tx) => {
    await transitionInTx(tx, orderId, 'ready', 'cancelled', ctx.actor, {
      reason: input.reason,
      requestId: ctx.requestId ?? null,
      data: { refundId: refund.id },
    })
    await audit(tx, {
      ...ctx,
      action: 'order.cancel',
      targetType: 'order',
      targetId: orderId,
      data: { reason: input.reason, money: 'refund', refundId: refund.id },
    })
  })
  return { order: (await getOrder(orderId))!, refund }
}

/** Refunds by agent over the last `days` (threat T16's weekly review). */
export async function refundsByAgent(
  days = 7,
): Promise<Array<{ createdBy: string; count: number; totalCents: number; largestCents: number }>> {
  const { rows } = await getDb().query(
    `SELECT created_by, count(*)::int AS count, sum(amount_cents)::bigint AS total,
       max(amount_cents)::bigint AS largest
     FROM finance.refunds WHERE status = 'succeeded' AND created_at > now() - ($1::int * interval '1 day')
     GROUP BY created_by ORDER BY total DESC`,
    [days],
  )
  return rows.map((r) => ({
    createdBy: r.created_by,
    count: r.count,
    totalCents: Number(r.total),
    largestCents: Number(r.largest),
  }))
}

/** A customer's refunds over the last 90 days (support auto-approval, ORDERS §10). */
export async function customerRefundTotal(
  customer: { userId: string | null; email: string },
  now: Date = new Date(),
): Promise<number> {
  const { rows } = await getDb().query<{ total: string }>(
    `SELECT COALESCE(sum(r.amount_cents), 0) AS total
     FROM finance.refunds r JOIN commerce.orders o ON o.id = r.order_id
     WHERE r.status IN ('pending', 'succeeded') AND r.created_at > $3::timestamptz - interval '90 days'
       AND (($1::text IS NOT NULL AND o.user_id = $1) OR lower(o.email) = lower($2))`,
    [customer.userId, customer.email, now],
  )
  return Number(rows[0].total)
}
