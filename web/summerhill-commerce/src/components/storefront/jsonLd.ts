import type { ProductSummary } from '@/modules/catalog'

/**
 * schema.org Product + Offer (G3-16) for rich results: name, image, description, brand, sku, and an
 * Offer with the price actually charged, currency, availability and seller. Weighed products state
 * the price per pound as a UnitPriceSpecification.
 */
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

/** JSON for a <script type="application/ld+json">: `<` escaped so the data can't close the tag. */
export const serializeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')
