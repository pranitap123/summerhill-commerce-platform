import { getMerchantById } from '@/modules/merchant'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

import { businessDayBounds, toCsv } from './reconciliation'

/**
 * Monthly merchant statement (G5-08, M12, PAYMENTS §10), built from the ledger so it can't drift
 * from it: every figure is a sum over the month's journals on the merchant's orders.
 *
 *  sales (GMV)            captured amounts
 *  commission, HST        what the platform kept at capture
 *  merchant share         transferred at capture (sales − commission − HST)
 *  refunds you bore       refunds reversed from the merchant (liability merchant/split)
 *  commission returned    the platform's fee refunded on those refunds
 *  refunds we bore        platform-liable refunds (shown for transparency; not deducted)
 *  dispute recoveries     chargebacks recovered from the merchant
 *  net transfers          merchant share − refunds you bore + commission returned − recoveries
 *  payouts                payouts to the bank (Stripe), for the same month
 */
export interface StatementLine {
  date: string
  publicId: string | null
  event: string
  salesCents: number
  commissionCents: number
  hstOnCommissionCents: number
  merchantRefundCents: number
  platformRefundCents: number
  commissionReturnedCents: number
  disputeRecoveryCents: number
  netCents: number
}

export interface MerchantStatement {
  merchantId: number
  merchantName: string
  month: string
  period: { from: string; to: string }
  orders: number
  salesCents: number
  commissionCents: number
  hstOnCommissionCents: number
  merchantShareCents: number
  merchantRefundCents: number
  platformRefundCents: number
  commissionReturnedCents: number
  disputeRecoveryCents: number
  netTransferCents: number
  payouts: { count: number; paidCents: number }
  lines: StatementLine[]
}

export function monthBounds(month: string): { from: Date; to: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new HttpError(400, 'VALIDATION_FAILED', 'month must be YYYY-MM')
  const [y, m] = month.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  return { from: businessDayBounds(`${month}-01`).from, to: businessDayBounds(next).from }
}

export async function merchantStatement(
  merchantId: number,
  month: string,
): Promise<MerchantStatement> {
  const merchant = await getMerchantById(merchantId)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  const { from, to } = monthBounds(month)
  const payable = `merchant_payable:${merchantId}`
  const { rows } = await getDb().query(
    `SELECT j.id, j.created_at, j.event, o.public_id,
       COALESCE(sum(e.credit_cents) FILTER (WHERE e.account = $4), 0) AS payable_cr,
       COALESCE(sum(e.debit_cents) FILTER (WHERE e.account = $4), 0) AS payable_dr,
       COALESCE(sum(e.credit_cents - e.debit_cents) FILTER (WHERE e.account = 'platform_fee_revenue'), 0) AS fee_net,
       COALESCE(sum(e.credit_cents - e.debit_cents) FILTER (WHERE e.account = 'hst_on_commission_payable'), 0) AS hst_net,
       COALESCE(sum(e.debit_cents - e.credit_cents) FILTER (WHERE e.account = 'refund_expense_platform'), 0) AS platform_refund,
       COALESCE(sum(e.credit_cents - e.debit_cents) FILTER (WHERE e.account = 'dispute_expense'), 0) AS dispute_credit
     FROM finance.ledger_journals j
     JOIN finance.ledger_entries e ON e.journal_id = j.id
     JOIN commerce.orders o ON o.id = j.order_id
     WHERE o.merchant_id = $1 AND j.created_at >= $2 AND j.created_at < $3
       AND j.event IN ('capture', 'refund', 'refund_failed', 'dispute_recovery')
     GROUP BY j.id, j.created_at, j.event, o.public_id
     ORDER BY j.id`,
    [merchantId, from, to, payable],
  )
  const lines: StatementLine[] = rows.map((r) => {
    const N = (k: string) => Number(r[k])
    const base = {
      date: (r.created_at as Date).toISOString(),
      publicId: r.public_id as string,
      event: r.event as string,
      salesCents: 0,
      commissionCents: 0,
      hstOnCommissionCents: 0,
      merchantRefundCents: 0,
      platformRefundCents: 0,
      commissionReturnedCents: 0,
      disputeRecoveryCents: 0,
      netCents: 0,
    }
    if (r.event === 'capture') {
      // The capture journal credits the merchant's share, then debits it for the transfer.
      const share = N('payable_cr')
      return {
        ...base,
        salesCents: share + N('fee_net') + N('hst_net'),
        commissionCents: N('fee_net'),
        hstOnCommissionCents: N('hst_net'),
        netCents: share,
      }
    }
    if (r.event === 'refund' || r.event === 'refund_failed') {
      // Pass-through pair: the merchant's share appears once as a debit and once as a credit.
      const sign = r.event === 'refund' ? 1 : -1
      const merchantShare = sign * (r.event === 'refund' ? N('payable_dr') : N('payable_cr'))
      const returned = -(N('fee_net') + N('hst_net'))
      return {
        ...base,
        merchantRefundCents: merchantShare,
        platformRefundCents: N('platform_refund'),
        commissionReturnedCents: returned,
        commissionCents: -returned,
        netCents: -merchantShare + returned,
      }
    }
    return { ...base, disputeRecoveryCents: N('dispute_credit'), netCents: -N('dispute_credit') }
  })
  const sum = (k: keyof StatementLine) => lines.reduce((s, l) => s + (l[k] as number), 0)
  const payouts = await getDb().query<{ count: number; paid: string }>(
    `SELECT count(*)::int AS count, COALESCE(sum(amount_cents), 0) AS paid FROM finance.payouts
     WHERE merchant_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
    [merchantId, from, to],
  )
  const captures = lines.filter((l) => l.event === 'capture')
  return {
    merchantId,
    merchantName: merchant.name,
    month,
    period: { from: from.toISOString(), to: to.toISOString() },
    orders: new Set(captures.map((l) => l.publicId)).size,
    salesCents: sum('salesCents'),
    commissionCents: captures.reduce((s, l) => s + l.commissionCents, 0),
    hstOnCommissionCents: sum('hstOnCommissionCents'),
    merchantShareCents: captures.reduce((s, l) => s + l.netCents, 0),
    merchantRefundCents: sum('merchantRefundCents'),
    platformRefundCents: sum('platformRefundCents'),
    commissionReturnedCents: sum('commissionReturnedCents'),
    disputeRecoveryCents: sum('disputeRecoveryCents'),
    netTransferCents: sum('netCents'),
    payouts: { count: payouts.rows[0].count, paidCents: Number(payouts.rows[0].paid) },
    lines,
  }
}

const dollars = (c: number) => (c / 100).toFixed(2)

export function statementCsv(s: MerchantStatement): string {
  const body = toCsv(
    [
      'date',
      'order',
      'event',
      'sales',
      'commission',
      'hst_on_commission',
      'refund_you_bore',
      'refund_we_bore',
      'commission_returned',
      'dispute_recovery',
      'net_to_you',
    ],
    s.lines.map((l) => [
      l.date,
      l.publicId,
      l.event,
      dollars(l.salesCents),
      dollars(l.event === 'capture' ? l.commissionCents : 0),
      dollars(l.hstOnCommissionCents),
      dollars(l.merchantRefundCents),
      dollars(l.platformRefundCents),
      dollars(l.commissionReturnedCents),
      dollars(l.disputeRecoveryCents),
      dollars(l.netCents),
    ]),
  )
  const totals = toCsv(
    [
      'total',
      '',
      '',
      dollars(s.salesCents),
      dollars(s.commissionCents),
      dollars(s.hstOnCommissionCents),
      dollars(s.merchantRefundCents),
      dollars(s.platformRefundCents),
      dollars(s.commissionReturnedCents),
      dollars(s.disputeRecoveryCents),
      dollars(s.netTransferCents),
    ],
    [],
  )
  return `# ${s.merchantName} statement ${s.month} (test mode, CAD)\r\n${body}${totals}`
}

/** Months with activity for a merchant, newest first (statement picker). */
export async function statementMonths(merchantId: number): Promise<string[]> {
  const { rows } = await getDb().query<{ month: string }>(
    `SELECT DISTINCT to_char(j.created_at AT TIME ZONE 'America/Toronto', 'YYYY-MM') AS month
     FROM finance.ledger_journals j JOIN commerce.orders o ON o.id = j.order_id
     WHERE o.merchant_id = $1 ORDER BY month DESC LIMIT 24`,
    [merchantId],
  )
  return rows.map((r) => r.month)
}
