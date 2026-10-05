import { raiseAlert } from '@/modules/ops'
import {
  getGateway,
  postJournal,
  postProcessingFee,
  type BalanceTransaction,
} from '@/modules/payments'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { DEFAULT_TIME_ZONE, fromWallClock, toWallClock } from '@/server/time'

/**
 * Daily reconciliation (G5-05, PAYMENTS §10, X6).
 *
 * 1. Stripe side: the platform's balance transactions for the business day (America/Toronto) are
 *    matched by id to our payments (charge), refunds (refund) and disputes (adjustment); amounts
 *    and Stripe fees must agree to the cent. Transfers, application fees and payouts are the
 *    mechanics of destination charges and are counted, not matched. A charge whose Stripe fee
 *    wasn't known at capture gets it posted now (the G2 follow-up).
 * 2. Our side: captured payments and succeeded refunds of the day that Stripe doesn't show.
 * 3. Invariants over all orders (see INVARIANTS).
 * Any difference > 0¢ becomes a recon item and one critical alert per run. Scheduled at 06:00
 * for the previous day; staff can re-run any day.
 */
export const INVARIANTS = {
  capture_split: 'Commission + merchant transfer = amount captured (capture journal)',
  lines_total:
    'Line totals + HST + deposits = final total = amount captured (unless a shortfall was absorbed)',
  ledger_balanced: 'Every order’s ledger balances (debits = credits)',
  captured_before_ready: 'No order is ready, collected or a no-show without a captured payment',
  captured_after_picking: 'No captured payment on an order that was never picked',
  refunds_within_capture: 'Refunds never exceed the amount captured',
} as const
export type InvariantName = keyof typeof INVARIANTS

export const RECON_HOUR_LOCAL = 6

export interface ReconItem {
  kind: 'unmatched_stripe' | 'missing_in_stripe' | 'amount_mismatch' | 'invariant'
  checkName: string
  orderId: number | null
  reference: string | null
  expected: number | null
  actual: number | null
  message: string
}

export interface ReconRun {
  id: number
  runDate: string
  trigger: 'schedule' | 'manual'
  status: 'running' | 'clean' | 'mismatches' | 'failed'
  matched: number
  mismatches: number
  summary: Record<string, unknown>
  error: string | null
  requestedBy: string | null
  startedAt: Date
  finishedAt: Date | null
  items?: Array<ReconItem & { publicId: string | null }>
}

/** [start, end) of a local business day. */
export function businessDayBounds(
  runDate: string,
  timeZone = DEFAULT_TIME_ZONE,
): { from: Date; to: Date } {
  const [year, month, day] = runDate.split('-').map(Number)
  const from = fromWallClock({ year, month, day, hour: 0, minute: 0 }, timeZone)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const to = fromWallClock(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  )
  return { from, to }
}

/** Yesterday's date in the business time zone, once it's past 06:00 there; else null. */
export function dueRunDate(now: Date, timeZone = DEFAULT_TIME_ZONE): string | null {
  const w = toWallClock(now, timeZone)
  if (w.hour < RECON_HOUR_LOCAL) return null
  const y = new Date(Date.UTC(w.year, w.month - 1, w.day - 1))
  return y.toISOString().slice(0, 10)
}

interface PaymentRow {
  id: string
  order_id: string
  public_id: string
  charge_id: string | null
  amount_captured_cents: string | null
  processing_fee_cents: string | null
}

/** Pure matching of Stripe balance transactions against our records (unit-tested). */
export function matchBalanceTransactions(
  txns: BalanceTransaction[],
  ours: {
    payments: Array<{
      orderId: number
      chargeId: string
      capturedCents: number
      processingFeeCents: number | null
    }>
    /**
     * Refunds that succeeded in the window (`expectRefund`: Stripe must show the refund), and
     * refunds that failed after succeeding (`failed`: Stripe shows a refund_failure).
     */
    refunds: Array<{
      orderId: number
      stripeRefundId: string
      amountCents: number
      expectRefund: boolean
      failed: boolean
    }>
    disputes: Array<{
      orderId: number
      stripeDisputeId: string
      amountCents: number
      feeCents: number
      reinstatedCents: number
    }>
    knownReversals: Set<string>
  },
): {
  matched: number
  informational: number
  items: ReconItem[]
  feesToPost: Array<{ orderId: number; feeCents: number }>
} {
  const byCharge = new Map(ours.payments.map((p) => [p.chargeId, p]))
  const byRefund = new Map(ours.refunds.map((r) => [r.stripeRefundId, r]))
  const refundSeen = new Set<string>()
  const byDispute = new Map(ours.disputes.map((d) => [d.stripeDisputeId, d]))
  const items: ReconItem[] = []
  const feesToPost: Array<{ orderId: number; feeCents: number }> = []
  let matched = 0
  let informational = 0
  const mismatch = (
    check: string,
    orderId: number,
    ref: string,
    expected: number,
    actual: number,
    message: string,
  ) =>
    items.push({
      kind: 'amount_mismatch',
      checkName: check,
      orderId,
      reference: ref,
      expected,
      actual,
      message,
    })

  for (const t of txns) {
    if (t.type === 'charge' || t.type === 'payment') {
      const p = t.sourceId ? byCharge.get(t.sourceId) : undefined
      if (!p) {
        items.push({
          kind: 'unmatched_stripe',
          checkName: 'charge',
          orderId: null,
          reference: t.sourceId ?? t.id,
          expected: null,
          actual: t.amountCents,
          message: `Stripe charge ${t.sourceId ?? t.id} has no captured payment here`,
        })
        continue
      }
      byCharge.delete(t.sourceId!)
      if (t.amountCents !== p.capturedCents)
        mismatch(
          'charge_amount',
          p.orderId,
          t.sourceId!,
          p.capturedCents,
          t.amountCents,
          'Captured amount differs from Stripe',
        )
      else if (p.processingFeeCents === null) {
        feesToPost.push({ orderId: p.orderId, feeCents: t.feeCents })
        matched++
      } else if (p.processingFeeCents !== t.feeCents)
        mismatch(
          'stripe_fee',
          p.orderId,
          t.sourceId!,
          p.processingFeeCents,
          t.feeCents,
          'Stripe processing fee differs from our record',
        )
      else matched++
    } else if (t.type === 'refund' || t.type === 'payment_refund') {
      const r = t.sourceId ? byRefund.get(t.sourceId) : undefined
      if (!r) {
        items.push({
          kind: 'unmatched_stripe',
          checkName: 'refund',
          orderId: null,
          reference: t.sourceId ?? t.id,
          expected: null,
          actual: t.amountCents,
          message: `Stripe refund ${t.sourceId ?? t.id} has no succeeded refund here`,
        })
        continue
      }
      refundSeen.add(t.sourceId!)
      if (-t.amountCents !== r.amountCents)
        mismatch(
          'refund_amount',
          r.orderId,
          t.sourceId!,
          r.amountCents,
          -t.amountCents,
          'Refund amount differs from Stripe',
        )
      else matched++
    } else if (t.type === 'refund_failure') {
      // Stripe gives a failed refund back to the balance; it must be a refund we marked failed.
      const r = t.sourceId ? byRefund.get(t.sourceId) : undefined
      if (!r?.failed)
        items.push({
          kind: 'unmatched_stripe',
          checkName: 'refund_failure',
          orderId: r?.orderId ?? null,
          reference: t.sourceId ?? t.id,
          expected: null,
          actual: t.amountCents,
          message: `Stripe reports refund ${t.sourceId ?? t.id} failed; it isn't failed here`,
        })
      else if (t.amountCents !== r.amountCents)
        mismatch(
          'refund_failure_amount',
          r.orderId,
          t.sourceId!,
          r.amountCents,
          t.amountCents,
          'Failed refund amount differs',
        )
      else matched++
    } else if (t.type === 'adjustment' && t.sourceId?.startsWith('dp_')) {
      const d = byDispute.get(t.sourceId)
      if (!d) {
        items.push({
          kind: 'unmatched_stripe',
          checkName: 'dispute',
          orderId: null,
          reference: t.sourceId,
          expected: null,
          actual: t.amountCents,
          message: `Stripe dispute ${t.sourceId} is not recorded here`,
        })
        continue
      }
      if (t.amountCents > 0) {
        // A won dispute: Stripe reinstates the funds (charge.dispute.funds_reinstated)
        if (t.amountCents !== d.reinstatedCents)
          mismatch(
            'dispute_reinstated',
            d.orderId,
            t.sourceId,
            d.reinstatedCents,
            t.amountCents,
            'Reinstated dispute funds differ from Stripe',
          )
        else matched++
        continue
      }
      if (-t.amountCents !== d.amountCents || t.feeCents !== d.feeCents)
        mismatch(
          'dispute_amount',
          d.orderId,
          t.sourceId,
          d.amountCents + d.feeCents,
          -t.amountCents + t.feeCents,
          'Dispute debit differs from Stripe',
        )
      else matched++
    } else if (t.type === 'transfer_refund' && t.sourceId && !ours.knownReversals.has(t.sourceId)) {
      items.push({
        kind: 'unmatched_stripe',
        checkName: 'transfer_reversal',
        orderId: null,
        reference: t.sourceId,
        expected: null,
        actual: t.amountCents,
        message: `Transfer reversal ${t.sourceId} is not recorded here`,
      })
    } else informational++
  }
  for (const p of byCharge.values())
    items.push({
      kind: 'missing_in_stripe',
      checkName: 'charge',
      orderId: p.orderId,
      reference: p.chargeId,
      expected: p.capturedCents,
      actual: null,
      message: 'Captured here but no Stripe charge that day',
    })
  for (const r of ours.refunds.filter((x) => x.expectRefund && !refundSeen.has(x.stripeRefundId)))
    items.push({
      kind: 'missing_in_stripe',
      checkName: 'refund',
      orderId: r.orderId,
      reference: r.stripeRefundId,
      expected: r.amountCents,
      actual: null,
      message: 'Refunded here but no Stripe refund that day',
    })
  return { matched, informational, items, feesToPost }
}

async function invariantItems(db: Db): Promise<ReconItem[]> {
  const q = async (check: InvariantName, sql: string) => {
    const { rows } = await db.query(sql)
    return rows.map((r): ReconItem => ({
      kind: 'invariant',
      checkName: check,
      orderId: r.order_id === null ? null : Number(r.order_id),
      reference: r.reference ?? null,
      expected: r.expected === null || r.expected === undefined ? null : Number(r.expected),
      actual: r.actual === null || r.actual === undefined ? null : Number(r.actual),
      message: INVARIANTS[check],
    }))
  }
  const results = await Promise.all([
    q(
      'capture_split',
      `
      SELECT p.order_id, j.idempotency_key AS reference, p.amount_captured_cents AS expected,
        COALESCE(sum(e.credit_cents) FILTER (WHERE e.account LIKE 'merchant_payable:%'
          OR e.account IN ('platform_fee_revenue', 'hst_on_commission_payable')), 0) AS actual
      FROM finance.payments p
      JOIN finance.ledger_journals j ON j.idempotency_key = 'capture:' || p.order_id
      JOIN finance.ledger_entries e ON e.journal_id = j.id
      WHERE p.status = 'captured'
      GROUP BY p.order_id, j.idempotency_key, p.amount_captured_cents
      HAVING p.amount_captured_cents <> COALESCE(sum(e.credit_cents) FILTER (WHERE e.account LIKE 'merchant_payable:%'
          OR e.account IN ('platform_fee_revenue', 'hst_on_commission_payable')), 0)`,
    ),
    q(
      'lines_total',
      `
      SELECT o.id AS order_id, o.public_id AS reference, o.final_total_cents AS expected,
        l.total AS actual
      FROM commerce.orders o
      JOIN finance.payments p ON p.order_id = o.id AND p.status = 'captured'
      JOIN LATERAL (SELECT COALESCE(sum(COALESCE(final_line_total_cents, 0) + COALESCE(final_tax_cents, 0)
          + COALESCE(final_deposit_cents, 0)), 0) AS total FROM commerce.order_lines WHERE order_id = o.id) l ON true
      WHERE l.total <> o.final_total_cents
         OR (p.amount_captured_cents <> o.final_total_cents AND NOT EXISTS (
              SELECT 1 FROM ops.alerts a WHERE a.dedupe_key = 'capture-shortfall:' || o.id))`,
    ),
    q(
      'ledger_balanced',
      `
      SELECT order_id, NULL AS reference, sum(debit_cents) AS expected, sum(credit_cents) AS actual
      FROM finance.ledger_entries WHERE order_id IS NOT NULL
      GROUP BY order_id HAVING sum(debit_cents) <> sum(credit_cents)`,
    ),
    q(
      'captured_before_ready',
      `
      SELECT o.id AS order_id, o.public_id AS reference, NULL AS expected, NULL AS actual
      FROM commerce.orders o
      WHERE o.status IN ('ready', 'collected', 'no_show')
        AND NOT EXISTS (SELECT 1 FROM finance.payments p WHERE p.order_id = o.id AND p.status = 'captured')`,
    ),
    q(
      'captured_after_picking',
      `
      SELECT o.id AS order_id, o.public_id AS reference, NULL AS expected, NULL AS actual
      FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id
      WHERE p.status = 'captured' AND o.status IN ('pending_payment', 'placed', 'accepted', 'picking', 'abandoned')`,
    ),
    q(
      'refunds_within_capture',
      `
      SELECT p.order_id, NULL AS reference, p.amount_captured_cents AS expected, sum(r.amount_cents) AS actual
      FROM finance.refunds r JOIN finance.payments p ON p.id = r.payment_id
      WHERE r.status IN ('pending', 'succeeded')
      GROUP BY p.order_id, p.amount_captured_cents
      HAVING sum(r.amount_cents) > COALESCE(p.amount_captured_cents, 0)`,
    ),
  ])
  return results.flat()
}

/** Runs one reconciliation. Scheduled runs are unique per day (a repeat returns null). */
export async function runReconciliation(input: {
  runDate: string
  trigger: 'schedule' | 'manual'
  requestedBy?: string | null
}): Promise<ReconRun | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.runDate))
    throw new HttpError(400, 'VALIDATION_FAILED', 'runDate must be YYYY-MM-DD')
  const db = getDb()
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO finance.recon_runs (run_date, trigger, requested_by) VALUES ($1, $2, $3)
     ON CONFLICT (run_date) WHERE trigger = 'schedule' DO NOTHING RETURNING id`,
    [input.runDate, input.trigger, input.requestedBy ?? null],
  )
  if (!inserted.rows[0]) return null
  const runId = Number(inserted.rows[0].id)
  try {
    const { from, to } = businessDayBounds(input.runDate)
    const [txns, payments, refunds, disputes, reversals] = await Promise.all([
      getGateway().listBalanceTransactions({ from, to }),
      db.query<PaymentRow>(
        `SELECT p.id, p.order_id, o.public_id, p.charge_id, p.amount_captured_cents, p.processing_fee_cents
         FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id
         WHERE p.status = 'captured' AND p.captured_at >= $1 AND p.captured_at < $2 AND p.charge_id IS NOT NULL`,
        [from, to],
      ),
      db.query(
        `SELECT order_id, stripe_refund_id, amount_cents, status,
           succeeded_at >= $1 AND succeeded_at < $2 AS expect_refund
         FROM finance.refunds
         WHERE stripe_refund_id IS NOT NULL AND status IN ('succeeded', 'failed')
           AND ((succeeded_at >= $1 AND succeeded_at < $2) OR (status = 'failed' AND succeeded_at IS NOT NULL
             AND updated_at >= $1 AND updated_at < $2))`,
        [from, to],
      ),
      db.query(
        `SELECT order_id, stripe_dispute_id, amount_cents, fee_cents, reinstated_cents FROM finance.disputes
         WHERE created_at >= $1::timestamptz - interval '1 day' AND created_at < $2::timestamptz + interval '1 day'`,
        [from, to],
      ),
      db.query<{ ref: string }>(
        `SELECT stripe_transfer_reversal_id AS ref FROM finance.refunds WHERE stripe_transfer_reversal_id IS NOT NULL
         UNION SELECT external_ref FROM finance.ledger_journals WHERE event = 'dispute_recovery' AND external_ref IS NOT NULL`,
      ),
    ])
    const result = matchBalanceTransactions(txns, {
      payments: payments.rows.map((p) => ({
        orderId: Number(p.order_id),
        chargeId: p.charge_id!,
        capturedCents: Number(p.amount_captured_cents),
        processingFeeCents: p.processing_fee_cents === null ? null : Number(p.processing_fee_cents),
      })),
      refunds: refunds.rows.map((r) => ({
        orderId: Number(r.order_id),
        stripeRefundId: r.stripe_refund_id,
        amountCents: Number(r.amount_cents),
        expectRefund: r.expect_refund === true,
        failed: r.status === 'failed',
      })),
      disputes: disputes.rows.map((d) => ({
        orderId: Number(d.order_id),
        stripeDisputeId: d.stripe_dispute_id,
        amountCents: Number(d.amount_cents),
        feeCents: Number(d.fee_cents),
        reinstatedCents: Number(d.reinstated_cents),
      })),
      knownReversals: new Set(reversals.rows.map((r) => r.ref)),
    })
    for (const f of result.feesToPost) await postLateProcessingFee(f.orderId, f.feeCents)
    const items = [...result.items, ...(await invariantItems(db))]
    await withTransaction(async (tx) => {
      for (const i of items)
        await tx.query(
          `INSERT INTO finance.recon_items (run_id, kind, check_name, order_id, reference, expected, actual, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [runId, i.kind, i.checkName, i.orderId, i.reference, i.expected, i.actual, i.message],
        )
      const summary = {
        stripeTransactions: txns.length,
        informational: result.informational,
        processingFeesPosted: result.feesToPost.length,
        capturedPayments: payments.rows.length,
        succeededRefunds: refunds.rows.length,
        invariantsChecked: Object.keys(INVARIANTS),
      }
      await tx.query(
        `UPDATE finance.recon_runs SET status = $2, matched = $3, mismatches = $4, summary = $5,
           finished_at = now() WHERE id = $1`,
        [runId, items.length ? 'mismatches' : 'clean', result.matched, items.length, summary],
      )
      if (items.length)
        await raiseAlert(tx, {
          kind: 'recon.mismatch',
          dedupeKey: `recon:${runId}`,
          severity: 'critical',
          message: `Reconciliation for ${input.runDate}: ${items.length} mismatch(es)`,
          data: {
            runId,
            runDate: input.runDate,
            checks: [...new Set(items.map((i) => i.checkName))],
          },
        })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.query(
      `UPDATE finance.recon_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [runId, message.slice(0, 1000)],
    )
    await raiseAlert(db, {
      kind: 'recon.failed',
      dedupeKey: `recon-failed:${runId}`,
      severity: 'critical',
      message: `Reconciliation for ${input.runDate} failed: ${message}`,
      data: { runId },
    })
  }
  return getReconRun(runId)
}

/** A Stripe fee learned after the capture (PAYMENTS §10, G2 follow-up). */
async function postLateProcessingFee(orderId: number, feeCents: number): Promise<void> {
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE finance.payments SET processing_fee_cents = $2
       WHERE order_id = $1 AND status = 'captured' AND processing_fee_cents IS NULL`,
      [orderId, feeCents],
    )
    if (rowCount)
      await postJournal(tx, {
        key: `processing-fee:${orderId}`,
        event: 'processing_fee',
        orderId,
        entries: postProcessingFee(feeCents),
      })
  })
}

/** The scheduled job: yesterday's run once it's past 06:00 local, at most once per day. */
export async function runScheduledReconciliation(now: Date = new Date()): Promise<ReconRun | null> {
  const runDate = dueRunDate(now)
  return runDate ? runReconciliation({ runDate, trigger: 'schedule' }) : null
}

function toRun(r: Record<string, unknown>): ReconRun {
  return {
    id: Number(r.id),
    runDate: String(r.run_date_text),
    trigger: r.trigger as ReconRun['trigger'],
    status: r.status as ReconRun['status'],
    matched: Number(r.matched),
    mismatches: Number(r.mismatches),
    summary: r.summary as Record<string, unknown>,
    error: (r.error as string) ?? null,
    requestedBy: (r.requested_by as string) ?? null,
    startedAt: r.started_at as Date,
    finishedAt: (r.finished_at as Date) ?? null,
  }
}

export async function listReconRuns(limit = 30): Promise<ReconRun[]> {
  const { rows } = await getDb().query(
    `SELECT *, run_date::text AS run_date_text FROM finance.recon_runs ORDER BY id DESC LIMIT $1`,
    [limit],
  )
  return rows.map(toRun)
}

export async function getReconRun(id: number): Promise<ReconRun | null> {
  const { rows } = await getDb().query(
    'SELECT *, run_date::text AS run_date_text FROM finance.recon_runs WHERE id = $1',
    [id],
  )
  if (!rows[0]) return null
  const items = await getDb().query(
    `SELECT i.*, o.public_id FROM finance.recon_items i LEFT JOIN commerce.orders o ON o.id = i.order_id
     WHERE i.run_id = $1 ORDER BY i.id`,
    [id],
  )
  return {
    ...toRun(rows[0]),
    items: items.rows.map((i) => ({
      kind: i.kind,
      checkName: i.check_name,
      orderId: i.order_id === null ? null : Number(i.order_id),
      publicId: i.public_id ?? null,
      reference: i.reference,
      expected: i.expected === null ? null : Number(i.expected),
      actual: i.actual === null ? null : Number(i.actual),
      message: i.message,
    })),
  }
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/**
 * Monthly close export (A10): every ledger entry of the month with its journal, for an
 * accounting import (QuickBooks/Xero map accounts to their chart of accounts).
 */
export async function monthlyCloseCsv(month: string): Promise<string> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new HttpError(400, 'VALIDATION_FAILED', 'month must be YYYY-MM')
  const [y, m] = month.split('-').map(Number)
  const { from } = businessDayBounds(`${month}-01`)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const { from: to } = businessDayBounds(next)
  const { rows } = await getDb().query(
    `SELECT j.created_at, j.idempotency_key, j.event, o.public_id, e.account, e.debit_cents, e.credit_cents, j.external_ref
     FROM finance.ledger_entries e JOIN finance.ledger_journals j ON j.id = e.journal_id
     LEFT JOIN commerce.orders o ON o.id = j.order_id
     WHERE j.created_at >= $1 AND j.created_at < $2 ORDER BY j.id, e.id`,
    [from, to],
  )
  return toCsv(
    ['date', 'journal', 'event', 'order', 'account', 'debit', 'credit', 'stripe_reference'],
    rows.map((r) => [
      (r.created_at as Date).toISOString(),
      r.idempotency_key,
      r.event,
      r.public_id,
      r.account,
      (Number(r.debit_cents) / 100).toFixed(2),
      (Number(r.credit_cents) / 100).toFixed(2),
      r.external_ref,
    ]),
  )
}
