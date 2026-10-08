import { computeFee, DEFAULT_FLAT_SCHEDULE } from './fees'

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
