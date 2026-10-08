export type LedgerAccount =
  | 'stripe_clearing'
  | `merchant_payable:${number}`
  | 'platform_fee_revenue'
  | 'hst_on_commission_payable'
  | 'processing_fee_expense'
  | 'refund_expense_platform'
  | 'dispute_expense'

export interface LedgerEntry {
  account: LedgerAccount
  debitCents: number
  creditCents: number
}

function pair(debit: LedgerAccount, credit: LedgerAccount, cents: number): LedgerEntry[] {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error(`ledger amount must be a non-negative integer, got ${cents}`)
  if (cents === 0) return []
  return [
    { account: debit, debitCents: cents, creditCents: 0 },
    { account: credit, debitCents: 0, creditCents: cents },
  ]
}

export function postCapture(p: {
  merchantId: number
  capturedCents: number
  applicationFeeCents: number
  hstOnCommissionCents: number

  processingFeeCents: number | null
}): LedgerEntry[] {
  if (p.applicationFeeCents > p.capturedCents)
    throw new Error('application fee cannot exceed the captured amount')
  if (p.hstOnCommissionCents > p.applicationFeeCents)
    throw new Error('HST on commission cannot exceed the application fee')
  const merchant: LedgerAccount = `merchant_payable:${p.merchantId}`
  const transfer = p.capturedCents - p.applicationFeeCents
  const commission = p.applicationFeeCents - p.hstOnCommissionCents
  return [
    ...pair('stripe_clearing', merchant, transfer),
    ...pair('stripe_clearing', 'platform_fee_revenue', commission),
    ...pair('stripe_clearing', 'hst_on_commission_payable', p.hstOnCommissionCents),
    ...pair(merchant, 'stripe_clearing', transfer),
    ...pair('processing_fee_expense', 'stripe_clearing', p.processingFeeCents ?? 0),
  ]
}

export function postProcessingFee(processingFeeCents: number): LedgerEntry[] {
  return pair('processing_fee_expense', 'stripe_clearing', processingFeeCents)
}

export function isBalanced(entries: LedgerEntry[]): boolean {
  const debits = entries.reduce((s, e) => s + e.debitCents, 0)
  const credits = entries.reduce((s, e) => s + e.creditCents, 0)
  return debits === credits
}

export function postRefund(p: {
  merchantId: number
  merchantCents: number
  platformCents: number
  feeRefundCents: number
  hstOnFeeRefundCents: number
}): LedgerEntry[] {
  if (p.hstOnFeeRefundCents > p.feeRefundCents)
    throw new Error('HST on the fee refund cannot exceed the fee refund')
  const merchant: LedgerAccount = `merchant_payable:${p.merchantId}`
  return [
    ...pair(merchant, 'stripe_clearing', p.merchantCents),
    ...pair('stripe_clearing', merchant, p.merchantCents),
    ...pair('refund_expense_platform', 'stripe_clearing', p.platformCents),
    ...pair('platform_fee_revenue', 'stripe_clearing', p.feeRefundCents - p.hstOnFeeRefundCents),
    ...pair('hst_on_commission_payable', 'stripe_clearing', p.hstOnFeeRefundCents),
  ]
}

export function reverseEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.map((e) => ({
    account: e.account,
    debitCents: e.creditCents,
    creditCents: e.debitCents,
  }))
}

export function postDispute(p: { amountCents: number; feeCents: number }): LedgerEntry[] {
  return pair('dispute_expense', 'stripe_clearing', p.amountCents + p.feeCents)
}

export function postDisputeCredit(cents: number): LedgerEntry[] {
  return pair('stripe_clearing', 'dispute_expense', cents)
}
