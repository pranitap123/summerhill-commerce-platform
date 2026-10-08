import { z } from 'zod'

import { applyBasisPoints, divideRoundHalfUp } from './money'

const rateBp = z.number().int().min(0).max(10_000)

export const flatTiersSchema = z
  .array(z.object({ minCents: z.number().int().min(0), rateBp }).strict())
  .min(1)
  .refine((t) => t.some((tier) => tier.minCents === 0), 'a flat schedule needs a tier from 0')

export const marginalTiersSchema = z
  .array(z.object({ upToCents: z.number().int().positive().nullable(), rateBp }).strict())
  .min(1)
  .refine((t) => t.at(-1)?.upToCents === null, 'the last marginal band must be open-ended')
  .refine(
    (t) => t.slice(0, -1).every((b, i) => i === 0 || b.upToCents! > t[i - 1].upToCents!),
    'marginal bands must be in increasing order',
  )

export type FeeSchedule =
  | {
      id: number
      mode: 'flat'
      tiers: z.infer<typeof flatTiersSchema>
      hstOnCommission: boolean
    }
  | {
      id: number
      mode: 'marginal'
      tiers: z.infer<typeof marginalTiersSchema>
      hstOnCommission: boolean
    }

export function parseFeeSchedule(row: {
  id: number
  mode: string
  tiers: unknown
  hst_on_commission: boolean
}): FeeSchedule {
  if (row.mode === 'flat')
    return {
      id: row.id,
      mode: 'flat',
      tiers: flatTiersSchema.parse(row.tiers),
      hstOnCommission: row.hst_on_commission,
    }
  if (row.mode === 'marginal')
    return {
      id: row.id,
      mode: 'marginal',
      tiers: marginalTiersSchema.parse(row.tiers),
      hstOnCommission: row.hst_on_commission,
    }
  throw new Error(`unknown fee schedule mode: ${row.mode}`)
}

export const HST_ON_COMMISSION_BP = 1300

export interface FeeResult {
  commissionCents: number
  hstOnCommissionCents: number

  applicationFeeCents: number

  effectiveRateBp: number
}

export function computeFee(itemSubtotalCents: number, schedule: FeeSchedule): FeeResult {
  if (!Number.isSafeInteger(itemSubtotalCents) || itemSubtotalCents < 0)
    throw new Error(`itemSubtotalCents must be a non-negative integer, got ${itemSubtotalCents}`)

  let commissionCents: number
  if (schedule.mode === 'flat') {
    const tier = [...schedule.tiers]
      .sort((a, b) => b.minCents - a.minCents)
      .find((t) => itemSubtotalCents >= t.minCents)!
    commissionCents = applyBasisPoints(itemSubtotalCents, tier.rateBp)
  } else {
    let lower = 0
    let weighted = 0
    for (const band of schedule.tiers) {
      const upper = band.upToCents ?? Number.POSITIVE_INFINITY
      const inBand = Math.max(0, Math.min(itemSubtotalCents, upper) - lower)
      weighted += inBand * band.rateBp
      if (itemSubtotalCents <= upper) break
      lower = upper
    }
    commissionCents = divideRoundHalfUp(weighted, 10_000)
  }

  const hstOnCommissionCents = schedule.hstOnCommission
    ? applyBasisPoints(commissionCents, HST_ON_COMMISSION_BP)
    : 0
  return {
    commissionCents,
    hstOnCommissionCents,
    applicationFeeCents: commissionCents + hstOnCommissionCents,
    effectiveRateBp:
      itemSubtotalCents === 0 ? 0 : divideRoundHalfUp(commissionCents * 10_000, itemSubtotalCents),
  }
}

export const DEFAULT_FLAT_SCHEDULE: Extract<FeeSchedule, { mode: 'flat' }> = {
  id: 0,
  mode: 'flat',
  tiers: [
    { minCents: 10_001, rateBp: 1000 },
    { minCents: 5000, rateBp: 1500 },
    { minCents: 0, rateBp: 2000 },
  ],
  hstOnCommission: false,
}
