import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { calculatePlatformFee } from '@/modules/pricing'

describe('calculatePlatformFee', () => {
  it.each([
    [0, 0.2, 0, 0],
    [1, 0.2, 0, 1],
    [4999, 0.2, 1000, 3999],
    [5000, 0.15, 750, 4250],
    [10000, 0.15, 1500, 8500],
    [10001, 0.1, 1000, 9001],
    [7756, 0.15, 1163, 6593],
  ])('%i¢ → %f rate, fee %i¢, net %i¢', (amount, rate, fee, net) => {
    expect(calculatePlatformFee(amount)).toEqual({
      orderAmountCents: amount,
      feePercent: rate,
      platformFeeCents: fee,
      merchantNetCents: net,
    })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (bad) => {
    expect(() => calculatePlatformFee(bad)).toThrow()
  })

  it('fee + net always equals the amount, and the fee never exceeds 20%', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (amount) => {
        const r = calculatePlatformFee(amount)
        expect(r.platformFeeCents + r.merchantNetCents).toBe(amount)
        expect(r.platformFeeCents).toBeGreaterThanOrEqual(0)
        expect(r.platformFeeCents).toBeLessThanOrEqual(Math.round(amount * 0.2))
        expect(Number.isInteger(r.platformFeeCents)).toBe(true)
      }),
    )
  })
})
