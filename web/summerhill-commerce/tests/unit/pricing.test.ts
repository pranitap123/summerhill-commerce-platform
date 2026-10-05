import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  applyBasisPoints,
  buildQuote,
  computeFee,
  DEFAULT_FLAT_SCHEDULE,
  divideRoundHalfUp,
  effectivePrice,
  finalizeOrder,
  lbToMlb,
  mlbToLb,
  parseFeeSchedule,
  planCapture,
  priceForWeight,
  type FeeSchedule,
  type FinalizableLine,
  type PricingProduct,
  type QuoteSettings,
} from '@/modules/pricing'

const MARGINAL: FeeSchedule = {
  id: 2,
  mode: 'marginal',
  tiers: [
    { upToCents: 5000, rateBp: 2000 },
    { upToCents: 10_000, rateBp: 1500 },
    { upToCents: null, rateBp: 1000 },
  ],
  hstOnCommission: false,
}

describe('integer helpers', () => {
  it.each([
    [0, 1, 0],
    [5, 10, 1], // 0.5 → 1 (half-up)
    [4, 10, 0],
    [15, 10, 2],
    [854_550, 100_000, 9], // 8.5455 → 9
  ])('divideRoundHalfUp(%i, %i) = %i', (n, d, expected) => {
    expect(divideRoundHalfUp(n, d)).toBe(expected)
  })

  it('rejects bad inputs', () => {
    expect(() => divideRoundHalfUp(-1, 10)).toThrow()
    expect(() => divideRoundHalfUp(1, 0)).toThrow()
    expect(() => divideRoundHalfUp(1.5, 10)).toThrow()
    expect(() => applyBasisPoints(100, -1)).toThrow()
    expect(() => priceForWeight(100, -1)).toThrow()
  })

  it('applyBasisPoints and priceForWeight round half-up', () => {
    expect(applyBasisPoints(998, 1300)).toBe(130) // 129.74
    expect(applyBasisPoints(499, 1300)).toBe(65) // 64.87
    expect(applyBasisPoints(5697, 1500)).toBe(855) // 854.55
    expect(priceForWeight(3599, 1500)).toBe(5399) // 5398.5
    expect(priceForWeight(149, 2200)).toBe(328) // 327.8
  })

  it.each([
    ['1.5', 1500],
    ['0.25', 250],
    [2.2, 2200],
    ['10', 10_000],
    ['0.001', 1],
  ])('lbToMlb(%j) = %i', (input, expected) => {
    expect(lbToMlb(input)).toBe(expected)
  })

  it.each(['1.2345', '-1', 'abc', '', '1e3'])('lbToMlb rejects %j', (bad) => {
    expect(() => lbToMlb(bad)).toThrow()
  })

  it('lbToMlb rejects weights beyond the safe integer range', () => {
    expect(() => lbToMlb('9'.repeat(20))).toThrow(/out of range/)
  })

  it('mlbToLb formats three decimals and round-trips', () => {
    expect(mlbToLb(1500)).toBe('1.500')
    expect(mlbToLb(5)).toBe('0.005')
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (m) => lbToMlb(mlbToLb(m)) === m),
    )
  })
})

describe('fee schedules', () => {
  // The cliff table in PAYMENTS §4.3, both modes.
  it.each([
    [2500, 500, 500],
    [4999, 1000, 1000],
    [5000, 750, 1000],
    [7756, 1163, 1413],
    [10_000, 1500, 1750],
    [10_001, 1000, 1750],
    [12_000, 1200, 1950],
    [20_000, 2000, 2750],
    [0, 0, 0],
  ])('%i¢ → flat %i¢, marginal %i¢', (subtotal, flat, marginal) => {
    expect(computeFee(subtotal, DEFAULT_FLAT_SCHEDULE).commissionCents).toBe(flat)
    expect(computeFee(subtotal, MARGINAL).commissionCents).toBe(marginal)
  })

  it('adds 13% HST on the commission when the schedule says so', () => {
    const fee = computeFee(7756, { ...DEFAULT_FLAT_SCHEDULE, hstOnCommission: true })
    expect(fee).toEqual({
      commissionCents: 1163,
      hstOnCommissionCents: 151, // 151.19
      applicationFeeCents: 1314,
      effectiveRateBp: 1499,
    })
  })

  it('reports the effective rate', () => {
    expect(computeFee(0, DEFAULT_FLAT_SCHEDULE).effectiveRateBp).toBe(0)
    expect(computeFee(10_000, DEFAULT_FLAT_SCHEDULE).effectiveRateBp).toBe(1500)
  })

  it('rejects a negative or fractional subtotal', () => {
    expect(() => computeFee(-1, DEFAULT_FLAT_SCHEDULE)).toThrow()
    expect(() => computeFee(1.5, MARGINAL)).toThrow()
  })

  it('marginal fees are continuous and never exceed 20%', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), (s) => {
        const a = computeFee(s, MARGINAL).commissionCents
        const b = computeFee(s + 1, MARGINAL).commissionCents
        expect(b - a).toBeGreaterThanOrEqual(0)
        expect(b - a).toBeLessThanOrEqual(1)
        expect(a).toBeLessThanOrEqual(applyBasisPoints(s, 2000))
      }),
    )
  })

  it('parses database rows and rejects malformed ones', () => {
    expect(
      parseFeeSchedule({
        id: 1,
        mode: 'flat',
        tiers: DEFAULT_FLAT_SCHEDULE.tiers,
        hst_on_commission: false,
      }),
    ).toMatchObject({ id: 1, mode: 'flat' })
    expect(
      parseFeeSchedule({ id: 2, mode: 'marginal', tiers: MARGINAL.tiers, hst_on_commission: true }),
    ).toMatchObject({ mode: 'marginal', hstOnCommission: true })
    expect(() =>
      parseFeeSchedule({ id: 3, mode: 'tiered', tiers: [], hst_on_commission: false }),
    ).toThrow(/unknown fee schedule mode/)
    expect(() =>
      parseFeeSchedule({
        id: 4,
        mode: 'flat',
        tiers: [{ minCents: 100, rateBp: 10 }],
        hst_on_commission: false,
      }),
    ).toThrow(/tier from 0/)
    expect(() =>
      parseFeeSchedule({
        id: 5,
        mode: 'marginal',
        tiers: [{ upToCents: 100, rateBp: 10 }],
        hst_on_commission: false,
      }),
    ).toThrow(/open-ended/)
    expect(() =>
      parseFeeSchedule({
        id: 6,
        mode: 'marginal',
        tiers: [
          { upToCents: 500, rateBp: 10 },
          { upToCents: 100, rateBp: 10 },
          { upToCents: null, rateBp: 10 },
        ],
        hst_on_commission: false,
      }),
    ).toThrow(/increasing/)
  })
})

const product = (over: Partial<PricingProduct> & { id: string }): PricingProduct => ({
  name: over.id,
  merchantId: 1,
  locationId: 1,
  available: true,
  pricingModel: 'each',
  sellBy: 'quantity',
  unitPriceCents: 500,
  promotions: [],
  estimatedWeightMlb: null,
  weightStepMlb: 250,
  minWeightMlb: 500,
  taxCode: 'ZERO_RATED',
  depositCents: 0,
  minQty: 0,
  maxQty: 0,
  ...over,
})
const NOW = new Date('2026-09-27T12:00:00Z')
const settings: QuoteSettings = {
  weightBufferBp: 1500,
  minOrderCents: 0,
  feeSchedule: DEFAULT_FLAT_SCHEDULE,
  now: NOW,
}
const each = (productId: string, quantity: number) => ({ productId, quantity, weightMlb: null })

describe('effectivePrice', () => {
  const at = (iso: string) => new Date(iso)
  it('uses the lowest active promotion', () => {
    const p = product({
      id: 'a',
      promotions: [
        { salePriceCents: 450, label: 'Sale', startsAt: null, endsAt: null },
        { salePriceCents: 400, label: 'Better', startsAt: at('2026-09-01'), endsAt: null },
        { salePriceCents: 100, label: 'Future', startsAt: at('2026-10-01'), endsAt: null },
        { salePriceCents: 100, label: 'Past', startsAt: null, endsAt: at('2026-09-27T12:00:00Z') },
        { salePriceCents: 900, label: 'Higher', startsAt: null, endsAt: null },
      ],
    })
    expect(effectivePrice(p, NOW)).toEqual({ unitPriceCents: 400, promoLabel: 'Better' })
  })
  it('falls back to the regular price', () => {
    expect(effectivePrice(product({ id: 'a' }), NOW)).toEqual({
      unitPriceCents: 500,
      promoLabel: null,
    })
  })
})

describe('buildQuote', () => {
  it('prices each, deposits, HST, promos and a sale label', () => {
    const q = buildQuote(
      [each('pop', 3)],
      [
        product({
          id: 'pop',
          unitPriceCents: 199,
          depositCents: 10,
          taxCode: 'HST_STANDARD',
          promotions: [{ salePriceCents: 149, label: 'Special', startsAt: null, endsAt: null }],
        }),
      ],
      settings,
    )
    expect(q.lines[0]).toMatchObject({
      regularUnitPriceCents: 199,
      unitPriceCents: 149,
      promoLabel: 'Special',
      lineTotalCents: 447,
      taxCents: 58, // 58.11
      depositCents: 30,
      isWeighed: false,
      unit: 'ea',
    })
    expect(q).toMatchObject({
      itemSubtotalCents: 447,
      depositCents: 30,
      taxCents: 58,
      estimatedTotalCents: 535,
      weightBufferCents: 0,
      authorizationCents: 535,
      canCheckout: true,
      merchantId: 1,
      locationId: 1,
    })
  })

  it('estimates per-weight items sold by quantity, with a default weight when unknown', () => {
    const q = buildQuote(
      [each('apples', 3)],
      [product({ id: 'apples', pricingModel: 'per_weight', unitPriceCents: 300 })],
      settings,
    )
    expect(q.lines[0]).toMatchObject({ estimatedWeightMlb: 3000, lineTotalCents: 900 })
    expect(q.weightBufferCents).toBe(135)
  })

  it('reports every validation problem without throwing', () => {
    const q = buildQuote(
      [
        each('gone', 1),
        each('oos', 1),
        { productId: 'steak', quantity: 1, weightMlb: null }, // sold by weight
        { productId: 'steak2', quantity: null, weightMlb: 600 }, // not a step multiple
        { productId: 'steak3', quantity: null, weightMlb: 250 }, // below minimum
        { productId: 'eggs', quantity: null, weightMlb: 1000 }, // sold by quantity
        each('limited', 7),
        each('minimum', 2),
        each('other-merchant', 1),
      ],
      [
        product({ id: 'oos', available: false }),
        product({ id: 'steak', pricingModel: 'per_weight', sellBy: 'weight' }),
        product({ id: 'steak2', pricingModel: 'per_weight', sellBy: 'weight' }),
        product({ id: 'steak3', pricingModel: 'per_weight', sellBy: 'weight' }),
        product({ id: 'eggs' }),
        product({ id: 'limited', maxQty: 6 }),
        product({ id: 'minimum', minQty: 3 }),
        product({ id: 'other-merchant', merchantId: 2, locationId: 2 }),
      ],
      { ...settings, minOrderCents: 100_000 },
    )
    expect(q.issues.map((i) => [i.productId, i.code])).toEqual([
      ['gone', 'ITEM_UNAVAILABLE'],
      ['oos', 'ITEM_UNAVAILABLE'],
      ['steak', 'WEIGHT_INVALID'],
      ['steak2', 'WEIGHT_INVALID'],
      ['steak3', 'WEIGHT_INVALID'],
      ['eggs', 'QUANTITY_INVALID'],
      ['limited', 'QUANTITY_INVALID'],
      ['minimum', 'QUANTITY_INVALID'],
      [null, 'CART_MIXED_MERCHANTS'],
      [null, 'BELOW_MINIMUM'],
    ])
    expect(q.issues[0].message).toBe('An item is no longer available')
    expect(q.canCheckout).toBe(false)
    expect(q.merchantId).toBeNull()
    expect(q.locationId).toBeNull()
  })

  it('flags an empty cart and too many lines', () => {
    expect(buildQuote([], [], settings).issues.map((i) => i.code)).toEqual(['CART_EMPTY'])
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`)
    const q = buildQuote(
      many.map((id) => each(id, 1)),
      many.map((id) => product({ id })),
      settings,
    )
    expect(q.issues.map((i) => i.code)).toEqual(['TOO_MANY_LINES'])
  })

  it('the hash changes when a price changes and is stable otherwise', () => {
    const p = [product({ id: 'a' })]
    const h1 = buildQuote([each('a', 1)], p, settings).hash
    expect(buildQuote([each('a', 1)], p, settings).hash).toBe(h1)
    expect(
      buildQuote([each('a', 1)], [product({ id: 'a', unitPriceCents: 501 })], settings).hash,
    ).not.toBe(h1)
    expect(buildQuote([each('a', 2)], p, settings).hash).not.toBe(h1)
  })

  it('every total is the sum of its lines (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 0, max: 50_000 }),
            qty: fc.integer({ min: 1, max: 99 }),
            weighed: fc.boolean(),
            taxed: fc.boolean(),
            deposit: fc.integer({ min: 0, max: 50 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (specs) => {
          const products = specs.map((s, i) =>
            product({
              id: `p${i}`,
              unitPriceCents: s.price,
              pricingModel: s.weighed ? 'per_weight' : 'each',
              estimatedWeightMlb: s.weighed ? 750 : null,
              taxCode: s.taxed ? 'HST_STANDARD' : 'ZERO_RATED',
              depositCents: s.deposit,
            }),
          )
          const q = buildQuote(
            specs.map((s, i) => each(`p${i}`, s.qty)),
            products,
            settings,
          )
          const sum = (f: (l: (typeof q.lines)[number]) => number) =>
            q.lines.reduce((a, l) => a + f(l), 0)
          expect(q.itemSubtotalCents).toBe(sum((l) => l.lineTotalCents))
          expect(q.taxCents).toBe(sum((l) => l.taxCents))
          expect(q.estimatedTotalCents).toBe(q.itemSubtotalCents + q.depositCents + q.taxCents)
          expect(q.authorizationCents).toBe(q.estimatedTotalCents + q.weightBufferCents)
        },
      ),
    )
  })
})

describe('finalizeOrder and planCapture', () => {
  const line = (over: Partial<FinalizableLine> & { lineNo: number }): FinalizableLine => ({
    status: 'picked',
    isWeighed: false,
    unitPriceCents: 500,
    taxRateBp: 0,
    quantity: 2,
    lineTotalCents: 1000,
    depositCents: 20,
    pickedQuantity: 2,
    actualWeightMlb: null,
    substitutesLineNo: null,
    ...over,
  })

  it('handles ordered, unavailable, partial and weighed-by-count lines', () => {
    const final = finalizeOrder(
      [
        line({ lineNo: 1, status: 'ordered', pickedQuantity: null }),
        line({ lineNo: 2, status: 'unavailable' }),
        line({ lineNo: 3, pickedQuantity: 1, taxRateBp: 1300 }),
        line({ lineNo: 4, isWeighed: true, quantity: 3, lineTotalCents: 901, pickedQuantity: 2 }),
        line({ lineNo: 5, pickedQuantity: null, quantity: null, lineTotalCents: 500 }),
      ],
      DEFAULT_FLAT_SCHEDULE,
    )
    expect(final.lines).toEqual([
      { lineNo: 1, lineTotalCents: 1000, taxCents: 0, depositCents: 20 },
      { lineNo: 2, lineTotalCents: 0, taxCents: 0, depositCents: 0 },
      { lineNo: 3, lineTotalCents: 500, taxCents: 65, depositCents: 10 },
      { lineNo: 4, lineTotalCents: 601, taxCents: 0, depositCents: 12 }, // 900.67… × 2/3 → 600.67 → 601
      { lineNo: 5, lineTotalCents: 500, taxCents: 0, depositCents: 20 },
    ])
    expect(final.totalCents).toBe(final.itemSubtotalCents + final.depositCents + final.taxCents)
  })

  it('charges the lower of the substitute price and the original estimate', () => {
    const final = finalizeOrder(
      [
        line({ lineNo: 1, status: 'substituted' }),
        line({ lineNo: 2, unitPriceCents: 700, substitutesLineNo: 1 }), // 1400 > 1000
        line({ lineNo: 3, status: 'substituted', lineTotalCents: 2000 }),
        line({ lineNo: 4, unitPriceCents: 300, substitutesLineNo: 3 }), // 600 < 2000
      ],
      DEFAULT_FLAT_SCHEDULE,
    )
    expect(final.lines.map((l) => l.lineTotalCents)).toEqual([0, 1000, 0, 600])
    expect(() =>
      finalizeOrder([line({ lineNo: 1, substitutesLineNo: 9 })], DEFAULT_FLAT_SCHEDULE),
    ).toThrow(/missing line/)
  })

  it('caps the capture at the authorisation, or at the overcapture maximum', () => {
    const final = finalizeOrder(
      [line({ lineNo: 1, quantity: 30, pickedQuantity: 30, depositCents: 0 })],
      DEFAULT_FLAT_SCHEDULE,
    )
    expect(final.totalCents).toBe(15_000)
    expect(planCapture(final, 20_000, null)).toEqual({
      amountToCaptureCents: 15_000,
      applicationFeeCents: 1500,
      shortfallCents: 0,
      usesOvercapture: false,
    })
    expect(planCapture(final, 14_000, null)).toMatchObject({
      amountToCaptureCents: 14_000,
      shortfallCents: 1000,
      usesOvercapture: false,
    })
    expect(planCapture(final, 14_000, 16_100)).toMatchObject({
      amountToCaptureCents: 15_000,
      shortfallCents: 0,
      usesOvercapture: true,
    })
    const zero = finalizeOrder([line({ lineNo: 1, status: 'unavailable' })], MARGINAL)
    expect(planCapture(zero, 1000, null)).toMatchObject({
      amountToCaptureCents: 0,
      applicationFeeCents: 0,
    })
  })
})

describe('remaining branches', () => {
  it('dollarsToCents rejects amounts beyond the safe integer range', async () => {
    const { dollarsToCents } = await import('@/modules/pricing')
    expect(() => dollarsToCents('9'.repeat(17))).toThrow(/out of range/)
  })

  it('a weighed line picked by count without quantity falls back to one unit', () => {
    const final = finalizeOrder(
      [
        {
          lineNo: 1,
          status: 'picked',
          isWeighed: true,
          unitPriceCents: 300,
          taxRateBp: 0,
          quantity: null,
          lineTotalCents: 450,
          depositCents: 0,
          pickedQuantity: null,
          actualWeightMlb: null,
          substitutesLineNo: null,
        },
      ],
      DEFAULT_FLAT_SCHEDULE,
    )
    expect(final.lines[0].lineTotalCents).toBe(450)
  })

  it('toPublicQuote removes the platform fee and keeps everything else', async () => {
    const { toPublicQuote } = await import('@/modules/pricing')
    const q = buildQuote([each('a', 1)], [product({ id: 'a' })], settings)
    const pub = toPublicQuote(q)
    expect('fee' in pub).toBe(false)
    expect(pub.hash).toBe(q.hash)
  })
})
