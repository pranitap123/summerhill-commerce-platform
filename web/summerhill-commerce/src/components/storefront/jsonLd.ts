import type { ProductSummary } from '@/modules/catalog'

export function productJsonLd(product: ProductSummary, baseUrl: string) {
  const url = new URL(`/products/${product.slug}`, baseUrl).toString()
  const price = (product.effectivePriceCents / 100).toFixed(2)
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url,
    price,
    priceCurrency: product.currency.trim().toUpperCase(),
    availability:
      product.availability === 'in_stock'
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: product.merchantName },
  }
  if (product.pricingModel === 'per_weight')
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: offer.priceCurrency,
      unitCode: 'LBR',
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'LBR' },
    }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || product.name,
    image: product.images.map((i) => new URL(i, baseUrl).toString()),
    sku: product.sku ?? product.id,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    category: `${product.category} > ${product.subcategory}`,
    offers: offer,
  }
}

export const serializeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')
