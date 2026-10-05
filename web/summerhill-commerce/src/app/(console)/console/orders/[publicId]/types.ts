/** The console order as the API returns it (JSON of fulfilment.consoleOrder). */
export interface Line {
  id: number
  lineNo: number
  productId: string
  name: string
  category: string | null
  upc: string | null
  image: string | null
  unit: 'ea' | 'lb'
  isWeighed: boolean
  sellBy: 'quantity' | 'weight'
  quantity: number | null
  estimatedWeightLb: number | null
  unitPriceCents: number
  lineTotalCents: number
  taxable: boolean
  cold: boolean
  replacementPreference: 'best_match' | 'specific' | 'refund'
  replacementProducts: Array<{ id: string; name: string; upc: string | null }>
  note: string | null
  status: 'ordered' | 'picked' | 'unavailable' | 'substituted'
  pickedQuantity: number | null
  actualWeightLb: number | null
  labelPriceCents: number | null
  scannedCode: string | null
  unavailableReason: string | null
  substitutionReason: string | null
  substitute: Line | null
  customerDecision: 'pending' | 'approved' | 'rejected' | null
}

export interface ConsoleOrder {
  publicId: string
  status: string
  statusLabel: string
  pickupName: string
  pickupStartsAt: string | null
  pickupEndsAt: string | null
  placedAt: string | null
  autoRejectAt: string | null
  arrivedAt: string | null
  arrivalNote: string | null
  pickerId: string | null
  pickedByMe: boolean
  pickupLocked: boolean
  role: 'owner' | 'manager' | 'picker'
  lines: Line[]
  unresolvedLines: number
  money: {
    estimatedTotalCents: number
    authorizedCents: number
    ceilingCents: number
    projectedTotalCents: number
    overCeilingCents: number
    finalTotalCents: number | null
  }
  timeline: Array<{
    type: string
    label: string
    actorType: string
    reason: string | null
    at: string
  }>
}

export interface ScanResult {
  match: 'line' | 'replacement' | 'not_in_order' | 'unknown' | 'invalid'
  lineId?: number
  productId?: string
  name?: string
  kind: string
  priceCents: number | null
  weightLb: number | null
}
