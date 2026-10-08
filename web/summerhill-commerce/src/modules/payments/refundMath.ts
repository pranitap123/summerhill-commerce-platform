import { divideRoundHalfUp } from '@/modules/pricing'

export interface RefundableLine {
  id: number
  isWeighed: boolean
  finalLineTotalCents: number
  finalTaxCents: number
  finalDepositCents: number

  paidUnits: number

  paidWeightMlb: number | null
}

export function lineFullCents(line: RefundableLine): number {
  return line.finalLineTotalCents + line.finalTaxCents + line.finalDepositCents
}

export function lineRefundCents(
  line: RefundableLine,
  part: { quantity?: number; weightMlb?: number } = {},
): number {
  const full = lineFullCents(line)
  if (part.weightMlb !== undefined) {
    if (!line.isWeighed || !line.paidWeightMlb)
      throw new RangeError('only weighed lines can be refunded by weight')
    if (part.weightMlb <= 0 || part.weightMlb > line.paidWeightMlb)
      throw new RangeError('refunded weight must be more than 0 and at most the weight paid for')
    return divideRoundHalfUp(full * part.weightMlb, line.paidWeightMlb)
  }
  if (part.quantity !== undefined) {
    if (!Number.isInteger(part.quantity) || part.quantity < 1 || part.quantity > line.paidUnits)
      throw new RangeError('refunded quantity must be between 1 and the quantity paid for')
    return divideRoundHalfUp(full * part.quantity, line.paidUnits)
  }
  return full
}

export function splitShares(
  liability: 'merchant' | 'platform' | 'split',
  amountCents: number,
  merchantShareCents?: number,
): { merchantCents: number; platformCents: number } {
  if (liability === 'merchant') return { merchantCents: amountCents, platformCents: 0 }
  if (liability === 'platform') return { merchantCents: 0, platformCents: amountCents }
  const m = merchantShareCents ?? divideRoundHalfUp(amountCents, 2)
  if (!Number.isInteger(m) || m <= 0 || m >= amountCents)
    throw new RangeError('a split refund needs a merchant share between 1¢ and the refund less 1¢')
  return { merchantCents: m, platformCents: amountCents - m }
}

export function hstShareOfFeeRefund(
  feeRefundCents: number,
  applicationFeeCents: number,
  hstOnCommissionCents: number,
): number {
  if (applicationFeeCents === 0) return 0
  return divideRoundHalfUp(feeRefundCents * hstOnCommissionCents, applicationFeeCents)
}
