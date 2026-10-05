/**
 * Comparison unit price (FEATURE_ROADMAP "Unit-price display"): the price per 100 g, per 100 ml or
 * per item, parsed from the pack size in the product name ("Spaghetti 500 g", "Cola 2 L",
 * "Free Run Eggs 12 ea"). Ontario shoppers expect it next to the shelf price. Weighed products are
 * already priced per lb and need no comparison price.
 */
export interface ComparisonPrice {
  cents: number
  per: '100 g' | '100 ml' | 'item'
}

interface PackSize {
  amount: number
  kind: 'g' | 'ml' | 'count'
}

const SIZE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|ea|pc|pk)\b/gi

/** The last pack size in the name ("… 6 × 355 ml" isn't parsed: no multipacks in the data yet). */
export function parsePackSize(name: string): PackSize | null {
  const matches = [...name.matchAll(SIZE)]
  const m = matches.at(-1)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  switch (m[2].toLowerCase()) {
    case 'kg':
      return { amount: value * 1000, kind: 'g' }
    case 'g':
      return { amount: value, kind: 'g' }
    case 'l':
      return { amount: value * 1000, kind: 'ml' }
    case 'ml':
      return { amount: value, kind: 'ml' }
    default:
      return value >= 2 ? { amount: value, kind: 'count' } : null
  }
}

/** Rounded half-up to the cent; null when there's nothing useful to compare. */
export function comparisonPrice(
  name: string,
  priceCents: number,
  pricingModel: 'each' | 'per_weight',
): ComparisonPrice | null {
  if (pricingModel !== 'each') return null
  const size = parsePackSize(name)
  if (!size) return null
  if (size.kind === 'count') return { cents: Math.round(priceCents / size.amount), per: 'item' }
  const per100 = (priceCents * 100) / size.amount
  return { cents: Math.round(per100), per: size.kind === 'g' ? '100 g' : '100 ml' }
}
