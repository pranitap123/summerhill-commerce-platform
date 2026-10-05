/**
 * Integer money and weight helpers (ADR-0006). Every amount is an integer number of cents; every
 * weight is an integer number of thousandths of a pound ("milli-pounds", mlb). Nothing here uses
 * floating-point arithmetic on money: products of cents and basis points stay far below 2^53.
 */

/**
 * Converts a decimal dollar amount (as returned by `pg` for NUMERIC, or typed by a person) into
 * integer cents without floating-point drift.
 * "10.99" → 1099, "3.1" → 310, "0.005" is rejected (more than 2 decimal places).
 */
export function dollarsToCents(value: string | number): number {
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim()
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!m) throw new Error(`invalid money amount: ${JSON.stringify(value)}`)
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error(`money amount out of range: ${text}`)
  return cents
}

function assertNonNegativeInt(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`${name} must be a non-negative integer, got ${n}`)
}

/** round_half_up(numerator / denominator) for non-negative integers. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  assertNonNegativeInt('numerator', numerator)
  if (!Number.isSafeInteger(denominator) || denominator <= 0)
    throw new Error(`denominator must be a positive integer, got ${denominator}`)
  return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

/** round_half_up(amount × rate), with the rate in basis points (1300 = 13%). */
export function applyBasisPoints(amountCents: number, rateBp: number): number {
  assertNonNegativeInt('amountCents', amountCents)
  assertNonNegativeInt('rateBp', rateBp)
  return divideRoundHalfUp(amountCents * rateBp, 10_000)
}

/** Price per lb × weight, rounded half-up to the cent. */
export function priceForWeight(unitPriceCentsPerLb: number, weightMlb: number): number {
  assertNonNegativeInt('unitPriceCentsPerLb', unitPriceCentsPerLb)
  assertNonNegativeInt('weightMlb', weightMlb)
  return divideRoundHalfUp(unitPriceCentsPerLb * weightMlb, 1000)
}

/**
 * Parses a weight in pounds (NUMERIC string from `pg`, or a number from JSON) into integer
 * thousandths of a pound. "1.5" → 1500, 0.25 → 250; more than 3 decimal places is rejected.
 */
export function lbToMlb(value: string | number): number {
  const text = typeof value === 'number' ? String(value) : value.trim()
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text)
  if (!m) throw new Error(`invalid weight: ${JSON.stringify(value)}`)
  const mlb = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
  if (!Number.isSafeInteger(mlb)) throw new Error(`weight out of range: ${text}`)
  return mlb
}

/** Integer thousandths of a pound → decimal string with 3 places, for NUMERIC columns. */
export function mlbToLb(mlb: number): string {
  assertNonNegativeInt('mlb', mlb)
  return `${Math.floor(mlb / 1000)}.${String(mlb % 1000).padStart(3, '0')}`
}
