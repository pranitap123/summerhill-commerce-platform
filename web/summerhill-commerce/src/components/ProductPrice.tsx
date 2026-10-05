import { formatCad, formatUnitPrice } from '@/utilities/money'

export interface PricedProduct {
  unitPriceCents: number
  effectivePriceCents: number
  onSale: boolean
  promoLabel: string | null
  unit: 'ea' | 'lb'
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  estimatedWeightLb: string | null
  comparisonPrice?: { cents: number; per: '100 g' | '100 ml' | 'item' } | null
}

/**
 * Price as sold: sale price with the regular price struck through, per lb for weighed items, and
 * the comparison unit price (per 100 g / 100 ml / item) shoppers expect (G3-10).
 */
export function ProductPrice({
  product,
  className = '',
  size = 'md',
}: {
  product: PricedProduct
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const main = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' }[size]
  return (
    <span className={className}>
      <span
        className={`${main} font-semibold ${product.onSale ? 'text-[#B3261E]' : 'text-[#1F3A2E]'}`}
      >
        {formatUnitPrice(product.effectivePriceCents, product.unit)}
      </span>
      {product.onSale && (
        <>
          {' '}
          <s className="text-sm font-normal text-neutral-600">
            <span className="sr-only">was </span>
            {formatUnitPrice(product.unitPriceCents, product.unit)}
          </s>
        </>
      )}
      {product.comparisonPrice && (
        <span className="block text-xs font-normal text-neutral-600">
          {formatCad(product.comparisonPrice.cents)} / {product.comparisonPrice.per}
        </span>
      )}
      {product.pricingModel === 'per_weight' &&
        product.sellBy === 'quantity' &&
        product.estimatedWeightLb && (
          <span className="block text-xs font-normal text-neutral-600">
            about {Number(product.estimatedWeightLb).toFixed(2)} lb each, charged by actual weight
          </span>
        )}
      {product.pricingModel === 'per_weight' && product.sellBy === 'weight' && (
        <span className="block text-xs font-normal text-neutral-600">charged by actual weight</span>
      )}
    </span>
  )
}

export function SaleBadge({ label }: { label: string | null }) {
  return (
    <span className="rounded bg-[#B3261E] px-1.5 py-0.5 text-xs font-medium text-white">
      {label ?? 'Sale'}
    </span>
  )
}
