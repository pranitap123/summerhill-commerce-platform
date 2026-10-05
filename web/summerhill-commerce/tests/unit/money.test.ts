import { describe, expect, it } from 'vitest'

import { dollarsToCents } from '@/modules/pricing'

describe('dollarsToCents', () => {
  it.each([
    ['10.99', 1099],
    ['3.1', 310],
    ['0', 0],
    ['0.01', 1],
    ['129.99', 12999],
    [4.99, 499],
    [0.1 + 0.2, 30], // floating-point input is rounded to 2 dp before conversion
  ])('%s → %i', (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected)
  })

  it.each(['0.005', '-1.00', 'abc', '', '1e3', '1,000.00'])('rejects %j', (bad) => {
    expect(() => dollarsToCents(bad)).toThrow()
  })
})
