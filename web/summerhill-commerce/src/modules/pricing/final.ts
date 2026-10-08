import { computeFee, type FeeResult, type FeeSchedule } from './fees'
import { applyBasisPoints, divideRoundHalfUp, priceForWeight } from './money'

export interface FinalizableLine {
  lineNo: number
  status: 'ordered' | 'picked' | 'unavailable' | 'substituted'
  isWeighed: boolean
  unitPriceCents: number
  taxRateBp: number
  quantity: number | null
  lineTotalCents: number
  depositCents: number
  pickedQuantity: number | null
  actualWeightMlb: number | null

  labelPriceCents?: number | null

  substitutesLineNo: number | null
}

export interface FinalLine {
  lineNo: number
  lineTotalCents: number
  taxCents: number
  depositCents: number
}

export interface FinalAmounts {
  lines: FinalLine[]
  itemSubtotalCents: number
  depositCents: number
  taxCents: number
  totalCents: number
  fee: FeeResult & { scheduleId: number }
}

function pickedTotal(line: FinalizableLine): { total: number; units: number } {
  if (line.labelPriceCents !== undefined && line.labelPriceCents !== null)
    return { total: line.labelPriceCents, units: line.pickedQuantity ?? 1 }
  if (line.isWeighed && line.actualWeightMlb !== null)
    return { total: priceForWeight(line.unitPriceCents, line.actualWeightMlb), units: 1 }
  const units = line.pickedQuantity ?? line.quantity ?? 1
  if (line.isWeighed) {
    return { total: divideRoundHalfUp(line.lineTotalCents * units, line.quantity ?? 1), units }
  }
  return { total: units * line.unitPriceCents, units }
}

function depositFor(line: FinalizableLine, units: number): number {
  const ordered = line.quantity ?? 1
  const perUnit = Math.floor(line.depositCents / ordered)
  return perUnit * units
}

export function finalizeOrder(lines: FinalizableLine[], schedule: FeeSchedule): FinalAmounts {
  const byNo = new Map(lines.map((l) => [l.lineNo, l]))
  const result: FinalLine[] = lines.map((line) => {
    let total: number
    let deposit: number
    if (line.status === 'unavailable') {
      total = 0
      deposit = 0
    } else if (line.substitutesLineNo !== null) {
      const original = byNo.get(line.substitutesLineNo)
      if (!original) throw new Error(`substitute line ${line.lineNo} points at a missing line`)
      const picked = pickedTotal(line)
      total = Math.min(picked.total, original.lineTotalCents)
      deposit = depositFor(line, picked.units)
    } else if (line.status === 'substituted') {
      total = 0
      deposit = 0
    } else if (line.status === 'ordered') {
      total = line.lineTotalCents
      deposit = line.depositCents
    } else {
      const picked = pickedTotal(line)
      total = picked.total
      deposit = depositFor(line, picked.units)
    }
    return {
      lineNo: line.lineNo,
      lineTotalCents: total,
      taxCents: applyBasisPoints(total, line.taxRateBp),
      depositCents: deposit,
    }
  })
  const sum = (f: (l: FinalLine) => number) => result.reduce((acc, l) => acc + f(l), 0)
  const itemSubtotalCents = sum((l) => l.lineTotalCents)
  const depositCents = sum((l) => l.depositCents)
  const taxCents = sum((l) => l.taxCents)
  return {
    lines: result,
    itemSubtotalCents,
    depositCents,
    taxCents,
    totalCents: itemSubtotalCents + depositCents + taxCents,
    fee: { ...computeFee(itemSubtotalCents, schedule), scheduleId: schedule.id },
  }
}

export interface CapturePlan {
  amountToCaptureCents: number
  applicationFeeCents: number

  shortfallCents: number
  usesOvercapture: boolean
}

export function planCapture(
  final: Pick<FinalAmounts, 'totalCents' | 'fee'>,
  authorizedCents: number,
  overcaptureMaximumCents: number | null,
): CapturePlan {
  const ceiling = Math.max(authorizedCents, overcaptureMaximumCents ?? 0)
  const amountToCaptureCents = Math.min(final.totalCents, ceiling)
  return {
    amountToCaptureCents,
    applicationFeeCents: Math.min(final.fee.applicationFeeCents, amountToCaptureCents),
    shortfallCents: final.totalCents - amountToCaptureCents,
    usesOvercapture: amountToCaptureCents > authorizedCents,
  }
}
