import { createHash } from 'node:crypto'

import { computeFee, type FeeResult, type FeeSchedule } from './fees'
import { applyBasisPoints, priceForWeight } from './money'

export type TaxCode = 'ZERO_RATED' | 'HST_STANDARD'
export const TAX_RATE_BP: Record<TaxCode, number> = { ZERO_RATED: 0, HST_STANDARD: 1300 }

export const MAX_CART_LINES = 50
export const MAX_QTY_PER_LINE = 99
export const MAX_WEIGHT_MLB = 50_000

export const DEFAULT_ESTIMATED_WEIGHT_MLB = 1000

export interface Promotion {
  salePriceCents: number
  label: string
  startsAt: Date | null
  endsAt: Date | null
}

export interface PricingProduct {
  id: string
  name: string
  merchantId: number
  locationId: number

  available: boolean
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  unitPriceCents: number
  promotions: Promotion[]
  estimatedWeightMlb: number | null
  weightStepMlb: number
  minWeightMlb: number
  taxCode: TaxCode
  depositCents: number

  minQty: number
  maxQty: number
}

export interface QuoteLineInput {
  productId: string
  quantity: number | null
  weightMlb: number | null
}

export interface QuoteSettings {
  weightBufferBp: number
  minOrderCents: number
  feeSchedule: FeeSchedule
  now: Date
}

export interface QuoteLine {
  productId: string
  name: string
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  unit: 'ea' | 'lb'
  regularUnitPriceCents: number
  unitPriceCents: number
  promoLabel: string | null
  quantity: number | null
  requestedWeightMlb: number | null

  estimatedWeightMlb: number | null
  isWeighed: boolean
  taxCode: TaxCode
  taxRateBp: number
  lineTotalCents: number
  taxCents: number
  depositCents: number
}

export type QuoteIssueCode =
  | 'CART_EMPTY'
  | 'TOO_MANY_LINES'
  | 'ITEM_UNAVAILABLE'
  | 'CART_MIXED_MERCHANTS'
  | 'QUANTITY_INVALID'
  | 'WEIGHT_INVALID'
  | 'BELOW_MINIMUM'

export interface QuoteIssue {
  productId: string | null
  code: QuoteIssueCode
  message: string
}

export interface Quote {
  currency: 'CAD'
  merchantId: number | null
  locationId: number | null
  lines: QuoteLine[]
  itemSubtotalCents: number
  depositCents: number
  taxCents: number
  estimatedTotalCents: number
  weighedEstimateCents: number
  weightBufferBp: number
  weightBufferCents: number
  authorizationCents: number
  minimumOrderCents: number
  meetsMinimum: boolean

  fee: FeeResult & { scheduleId: number }
  issues: QuoteIssue[]
  canCheckout: boolean

  hash: string
}

export function effectivePrice(
  product: Pick<PricingProduct, 'unitPriceCents' | 'promotions'>,
  now: Date,
): { unitPriceCents: number; promoLabel: string | null } {
  let best = { unitPriceCents: product.unitPriceCents, promoLabel: null as string | null }
  for (const p of product.promotions) {
    const active =
      (!p.startsAt || p.startsAt.getTime() <= now.getTime()) &&
      (!p.endsAt || p.endsAt.getTime() > now.getTime())
    if (active && p.salePriceCents < best.unitPriceCents)
      best = { unitPriceCents: p.salePriceCents, promoLabel: p.label }
  }
  return best
}

function priceLine(
  input: QuoteLineInput,
  product: PricingProduct,
  now: Date,
): { line: QuoteLine } | { issue: QuoteIssue } {
  const issue = (code: QuoteIssueCode, message: string) => ({
    issue: { productId: product.id, code, message },
  })
  const { unitPriceCents, promoLabel } = effectivePrice(product, now)
  const isWeighed = product.pricingModel === 'per_weight'
  const byWeight = isWeighed && product.sellBy === 'weight'
  let quantity: number | null = null
  let requestedWeightMlb: number | null = null
  let estimatedWeightMlb: number | null = null
  let lineTotalCents: number

  if (byWeight) {
    const w = input.weightMlb
    if (input.quantity !== null || w === null || !Number.isSafeInteger(w))
      return issue('WEIGHT_INVALID', `${product.name} is sold by weight`)
    if (w < product.minWeightMlb || w > MAX_WEIGHT_MLB || w % product.weightStepMlb !== 0)
      return issue(
        'WEIGHT_INVALID',
        `Choose a weight for ${product.name} between ${product.minWeightMlb / 1000} lb and ${MAX_WEIGHT_MLB / 1000} lb, in steps of ${product.weightStepMlb / 1000} lb`,
      )
    requestedWeightMlb = w
    estimatedWeightMlb = w
    lineTotalCents = priceForWeight(unitPriceCents, w)
  } else {
    const q = input.quantity
    if (input.weightMlb !== null || q === null || !Number.isSafeInteger(q) || q < 1)
      return issue('QUANTITY_INVALID', `${product.name} is sold by quantity`)
    const min = Math.max(1, product.minQty)
    const max = product.maxQty > 0 ? Math.min(product.maxQty, MAX_QTY_PER_LINE) : MAX_QTY_PER_LINE
    if (q < min || q > max)
      return issue('QUANTITY_INVALID', `Choose between ${min} and ${max} of ${product.name}`)
    quantity = q
    if (isWeighed) {
      estimatedWeightMlb = q * (product.estimatedWeightMlb ?? DEFAULT_ESTIMATED_WEIGHT_MLB)
      lineTotalCents = priceForWeight(unitPriceCents, estimatedWeightMlb)
    } else {
      lineTotalCents = q * unitPriceCents
    }
  }

  const taxRateBp = TAX_RATE_BP[product.taxCode]
  return {
    line: {
      productId: product.id,
      name: product.name,
      pricingModel: product.pricingModel,
      sellBy: isWeighed ? product.sellBy : 'quantity',
      unit: isWeighed ? 'lb' : 'ea',
      regularUnitPriceCents: product.unitPriceCents,
      unitPriceCents,
      promoLabel,
      quantity,
      requestedWeightMlb,
      estimatedWeightMlb,
      isWeighed,
      taxCode: product.taxCode,
      taxRateBp,
      lineTotalCents,
      taxCents: applyBasisPoints(lineTotalCents, taxRateBp),
      depositCents: product.depositCents * (quantity ?? 1),
    },
  }
}

export function buildQuote(
  inputs: QuoteLineInput[],
  products: PricingProduct[],
  settings: QuoteSettings,
): Quote {
  const byId = new Map(products.map((p) => [p.id, p]))
  const issues: QuoteIssue[] = []
  const lines: QuoteLine[] = []

  if (inputs.length === 0)
    issues.push({ productId: null, code: 'CART_EMPTY', message: 'Your cart is empty' })
  if (inputs.length > MAX_CART_LINES)
    issues.push({
      productId: null,
      code: 'TOO_MANY_LINES',
      message: `A cart can hold at most ${MAX_CART_LINES} different items`,
    })

  const merchants = new Set<number>()
  let locationId: number | null = null
  for (const input of inputs) {
    const product = byId.get(input.productId)
    if (!product || !product.available) {
      issues.push({
        productId: input.productId,
        code: 'ITEM_UNAVAILABLE',
        message: `${product?.name ?? 'An item'} is no longer available`,
      })
      continue
    }
    merchants.add(product.merchantId)
    locationId ??= product.locationId
    const result = priceLine(input, product, settings.now)
    if ('issue' in result) issues.push(result.issue)
    else lines.push(result.line)
  }
  if (merchants.size > 1)
    issues.push({
      productId: null,
      code: 'CART_MIXED_MERCHANTS',
      message: 'A cart can only contain items from one store',
    })

  const sum = (f: (l: QuoteLine) => number) => lines.reduce((acc, l) => acc + f(l), 0)
  const itemSubtotalCents = sum((l) => l.lineTotalCents)
  const depositCents = sum((l) => l.depositCents)
  const taxCents = sum((l) => l.taxCents)
  const weighedEstimateCents = sum((l) => (l.isWeighed ? l.lineTotalCents : 0))
  const weightBufferCents = applyBasisPoints(weighedEstimateCents, settings.weightBufferBp)
  const estimatedTotalCents = itemSubtotalCents + depositCents + taxCents
  const meetsMinimum = itemSubtotalCents >= settings.minOrderCents
  if (lines.length > 0 && !meetsMinimum)
    issues.push({
      productId: null,
      code: 'BELOW_MINIMUM',
      message: `The minimum order is $${(settings.minOrderCents / 100).toFixed(2)} of items`,
    })

  const fee = computeFee(itemSubtotalCents, settings.feeSchedule)
  const quote: Omit<Quote, 'hash'> = {
    currency: 'CAD',
    merchantId: merchants.size === 1 ? [...merchants][0] : null,
    locationId: merchants.size === 1 ? locationId : null,
    lines,
    itemSubtotalCents,
    depositCents,
    taxCents,
    estimatedTotalCents,
    weighedEstimateCents,
    weightBufferBp: settings.weightBufferBp,
    weightBufferCents,
    authorizationCents: estimatedTotalCents + weightBufferCents,
    minimumOrderCents: settings.minOrderCents,
    meetsMinimum,
    fee: { ...fee, scheduleId: settings.feeSchedule.id },
    issues,
    canCheckout: issues.length === 0,
  }
  return { ...quote, hash: quoteHash(quote) }
}

export function quoteHash(q: Omit<Quote, 'hash'>): string {
  const material = {
    v: 1,
    lines: q.lines.map((l) => [
      l.productId,
      l.quantity,
      l.requestedWeightMlb,
      l.estimatedWeightMlb,
      l.unitPriceCents,
      l.taxCode,
      l.lineTotalCents,
      l.taxCents,
      l.depositCents,
    ]),
    totals: [q.itemSubtotalCents, q.depositCents, q.taxCents, q.weightBufferCents],
    authorization: q.authorizationCents,
    feeScheduleId: q.fee.scheduleId,
    fee: q.fee.applicationFeeCents,
    minimum: q.minimumOrderCents,
    issues: q.issues.map((i) => [i.code, i.productId]),
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 32)
}

export type PublicQuote = Omit<Quote, 'fee'>

export function toPublicQuote(quote: Quote): PublicQuote {
  const { fee: _fee, ...rest } = quote
  return rest
}
