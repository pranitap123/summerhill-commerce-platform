import { computeFee, DEFAULT_FLAT_SCHEDULE } from './fees'

/**
 * Tiered platform revenue-share, per the assessment brief:
 *   > $100      -> 10%
 *   $50 - $100  -> 15%  (inclusive both ends)
 *   < $50       -> 20%
 *
 * A thin view over `computeFee` with the default flat schedule, kept for callers and reports that
 * want the rate as a fraction. Integer cents throughout: Stripe's application_fee_amount and
 * transfer amounts are integer cents, and doing the maths in dollars is how off-by-one-cent
 * payout bugs creep in.
 */
export interface RevenueShareResult {
  orderAmountCents: number
  platformFeeCents: number
  merchantNetCents: number
  feePercent: number
}

export function calculatePlatformFee(orderAmountCents: number): RevenueShareResult {
  if (!Number.isInteger(orderAmountCents) || orderAmountCents < 0) {
    throw new Error(`orderAmountCents must be a non-negative integer, got ${orderAmountCents}`)
  }
  const tier = DEFAULT_FLAT_SCHEDULE.tiers.find((t) => orderAmountCents >= t.minCents)!
  const platformFeeCents = computeFee(orderAmountCents, DEFAULT_FLAT_SCHEDULE).commissionCents
  return {
    orderAmountCents,
    platformFeeCents,
    merchantNetCents: orderAmountCents - platformFeeCents,
    feePercent: tier.rateBp / 10_000,
  }
}
