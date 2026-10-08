import { describe, expect, it } from 'vitest'

import { postCapture } from '@/modules/payments'
import {
  buildQuote,
  DEFAULT_FLAT_SCHEDULE,
  finalizeOrder,
  planCapture,
  type FinalizableLine,
  type PricingProduct,
} from '@/modules/pricing'

const base: Pick<
  PricingProduct,
  | 'merchantId'
  | 'locationId'
  | 'available'
  | 'promotions'
  | 'weightStepMlb'
  | 'minWeightMlb'
  | 'depositCents'
  | 'minQty'
  | 'maxQty'
> = {
  merchantId: 1,
  locationId: 1,
  available: true,
  promotions: [],
  weightStepMlb: 250,
  minWeightMlb: 500,
  depositCents: 0,
  minQty: 0,
  maxQty: 0,
}

const products: PricingProduct[] = [
  {
    ...base,
    id: 'bananas',
    name: 'Bananas',
    pricingModel: 'per_weight',
    sellBy: 'quantity', // 5 bananas × 0.4 lb ≈ 2.00 lb
    unitPriceCents: 149,
    estimatedWeightMlb: 400,
    taxCode: 'ZERO_RATED',
  },
  {
    ...base,
    id: 'eggs',
    name: 'Heritage Eggs XL 1 dozen',
    pricingModel: 'each',
    sellBy: 'quantity',
    unitPriceCents: 1099,
    estimatedWeightMlb: null,
    taxCode: 'ZERO_RATED',
  },
  {
    ...base,
    id: 'chips',
    name: 'Chips',
    pricingModel: 'each',
    sellBy: 'quantity',
    unitPriceCents: 499,
    estimatedWeightMlb: null,
    taxCode: 'HST_STANDARD',
  },
  {
    ...base,
    id: 'steak',
    name: 'Rib steak',
    pricingModel: 'per_weight',
    sellBy: 'weight',
    unitPriceCents: 3599,
    estimatedWeightMlb: null,
    taxCode: 'ZERO_RATED',
  },
]

const quote = buildQuote(
  [
    { productId: 'bananas', quantity: 5, weightMlb: null },
    { productId: 'eggs', quantity: 1, weightMlb: null },
    { productId: 'chips', quantity: 2, weightMlb: null },
    { productId: 'steak', quantity: null, weightMlb: 1500 },
  ],
  products,
  {
    weightBufferBp: 1500,
    minOrderCents: 0,
    feeSchedule: DEFAULT_FLAT_SCHEDULE,
    now: new Date('2026-09-27T12:00:00Z'),
  },
)

describe('golden money test: PAYMENTS §9 worked example', () => {
  it('estimate: lines, subtotal, HST, weight buffer, authorisation', () => {
    expect(quote.issues).toEqual([])
    expect(quote.lines.map((l) => [l.productId, l.lineTotalCents, l.taxCents])).toEqual([
      ['bananas', 298, 0],
      ['eggs', 1099, 0],
      ['chips', 998, 130],
      ['steak', 5399, 0],
    ])
    expect(quote.itemSubtotalCents).toBe(7794)
    expect(quote.taxCents).toBe(130)
    expect(quote.weighedEstimateCents).toBe(5697)
    expect(quote.weightBufferCents).toBe(855)
    expect(quote.authorizationCents).toBe(8779)
  })

  const lines: FinalizableLine[] = quote.lines.map((l, i) => ({
    lineNo: i + 1,
    status: 'picked',
    isWeighed: l.isWeighed,
    unitPriceCents: l.unitPriceCents,
    taxRateBp: l.taxRateBp,
    quantity: l.quantity,
    lineTotalCents: l.lineTotalCents,
    depositCents: l.depositCents,
    pickedQuantity: l.quantity,
    actualWeightMlb: null,
    substitutesLineNo: null,
  }))
  lines[0].actualWeightMlb = 2200
  lines[2].pickedQuantity = 1
  lines[3].actualWeightMlb = 1620
  const final = finalizeOrder(lines, DEFAULT_FLAT_SCHEDULE)

  it('final amounts after picking', () => {
    expect(final.lines.map((l) => l.lineTotalCents)).toEqual([328, 1099, 499, 5830])
    expect(final.itemSubtotalCents).toBe(7756)
    expect(final.taxCents).toBe(65)
    expect(final.totalCents).toBe(7821)
  })

  it('capture: fee on the final subtotal, hold released, transfer to the merchant', () => {
    const plan = planCapture(final, quote.authorizationCents, null)
    expect(plan.amountToCaptureCents).toBe(7821)
    expect(quote.authorizationCents - plan.amountToCaptureCents).toBe(958)
    expect(final.fee.commissionCents).toBe(1163)
    expect(plan.applicationFeeCents).toBe(1163)
    expect(plan.amountToCaptureCents - plan.applicationFeeCents).toBe(6658)
  })

  it('journal balances and nets to the platform contribution', () => {
    const entries = postCapture({
      merchantId: 1,
      capturedCents: 7821,
      applicationFeeCents: 1163,
      hstOnCommissionCents: 0,
      processingFeeCents: 257, // ≈ 2.9% + 30¢ of $78.21
    })
    expect(entries).toEqual([
      { account: 'stripe_clearing', debitCents: 6658, creditCents: 0 },
      { account: 'merchant_payable:1', debitCents: 0, creditCents: 6658 },
      { account: 'stripe_clearing', debitCents: 1163, creditCents: 0 },
      { account: 'platform_fee_revenue', debitCents: 0, creditCents: 1163 },
      { account: 'merchant_payable:1', debitCents: 6658, creditCents: 0 },
      { account: 'stripe_clearing', debitCents: 0, creditCents: 6658 },
      { account: 'processing_fee_expense', debitCents: 257, creditCents: 0 },
      { account: 'stripe_clearing', debitCents: 0, creditCents: 257 },
    ])
    const debits = entries.reduce((s, e) => s + e.debitCents, 0)
    const credits = entries.reduce((s, e) => s + e.creditCents, 0)
    expect(debits).toBe(credits)
    const clearing = entries
      .filter((e) => e.account === 'stripe_clearing')
      .reduce((s, e) => s + e.debitCents - e.creditCents, 0)
    expect(clearing).toBe(906)
  })
})
