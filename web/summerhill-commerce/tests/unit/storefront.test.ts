import { describe, expect, it } from 'vitest'

import { claimLabel, formatDays } from '@/components/storefront/format'
import { productJsonLd, serializeJsonLd } from '@/components/storefront/jsonLd'
import { hrefWith, parseListing, toQuery } from '@/components/storefront/params'
import type { ProductSummary } from '@/modules/catalog'

const product: ProductSummary = {
  id: 'DEMO-0001',
  slug: 'bananas-abc123',
  name: 'Organic Bananas',
  brand: 'Lakeside Farms',
  upc: null,
  description: 'Sweet.',
  currency: 'CAD',
  sku: 'SKU1',
  availability: 'in_stock',
  isVisible: true,
  images: ['/placeholder-product.svg'],
  merchantId: 1,
  merchantSlug: 'demo-market',
  merchantName: 'Demo Market',
  category: 'Produce',
  categorySlug: 'produce',
  subcategory: 'Fresh Fruit',
  subcategorySlug: 'fresh-fruit',
  pricingModel: 'per_weight',
  unit: 'lb',
  sellBy: 'quantity',
  unitPriceCents: 89,
  effectivePriceCents: 79,
  promoLabel: 'Special',
  onSale: true,
  comparisonPrice: null,
  estimatedWeightLb: '1.5',
  weightStepLb: '0.25',
  minWeightLb: '0.5',
  taxCode: 'ZERO_RATED',
  depositCents: 0,
  minQty: 0,
  maxQty: 0,
  availableDays: [],
  organic: true,
  dietaryClaims: ['vegan'],
  nutritionLabel: null,
  disclaimer: null,
  pickupOnly: false,
  updatedAt: '2026-09-27T00:00:00.000Z',
}

describe('Product JSON-LD (G3-16)', () => {
  it('has every field Google requires for a product rich result', () => {
    const ld = productJsonLd(product, 'https://demo.example')
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('Product')
    expect(ld.name).toBe('Organic Bananas')
    expect(ld.image).toEqual(['https://demo.example/placeholder-product.svg'])
    expect(ld.brand).toEqual({ '@type': 'Brand', name: 'Lakeside Farms' })
    expect(ld.offers).toMatchObject({
      '@type': 'Offer',
      url: 'https://demo.example/products/bananas-abc123',
      price: '0.79', // the price actually charged (sale), as a decimal string
      priceCurrency: 'CAD',
      availability: 'https://schema.org/InStock',
      priceSpecification: { unitCode: 'LBR' },
    })
  })

  it('marks unavailable products and omits a missing brand', () => {
    const ld = productJsonLd(
      { ...product, brand: null, availability: 'out_of_stock', pricingModel: 'each', unit: 'ea' },
      'https://demo.example',
    )
    expect(ld).not.toHaveProperty('brand')
    expect(ld.offers).toMatchObject({ availability: 'https://schema.org/OutOfStock' })
    expect(ld.offers).not.toHaveProperty('priceSpecification')
  })

  it('serialises safely inside a script tag', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>' })
    expect(json).not.toContain('</script>')
    expect(JSON.parse(json).name).toBe('</script><script>alert(1)</script>')
  })
})

describe('storefront URL state (G3-13)', () => {
  it('parses leniently and round-trips', () => {
    const state = parseListing({
      q: ' apples ',
      sub: 'fresh-fruit',
      organic: '1',
      diet: ['vegan', 'glutenFree', 'bad claim!'],
      min: '2',
      max: '10.5',
      sort: 'price_asc',
      page: '3',
    })
    expect(state).toMatchObject({
      q: 'apples',
      subcategory: 'fresh-fruit',
      organic: true,
      dietary: ['vegan', 'glutenFree'],
      min: '2',
      max: '10.5',
      sort: 'price_asc',
      page: 3,
    })
    const qs = new URLSearchParams(hrefWith('/shop', state, { page: 3 }).split('?')[1])
    const raw: Record<string, string | string[]> = {}
    for (const k of new Set(qs.keys())) raw[k] = qs.getAll(k).length > 1 ? qs.getAll(k) : qs.get(k)!
    expect(parseListing(raw)).toEqual(state)
  })

  it('drops invalid values instead of failing', () => {
    expect(
      parseListing({ sort: 'drop table', page: '-4', min: 'abc', sub: 'Not A Slug' }),
    ).toMatchObject({
      sort: 'relevance',
      page: 1,
      min: undefined,
      subcategory: undefined,
    })
  })

  it('converts dollars to cents and applies fixed filters', () => {
    const q = toQuery(parseListing({ min: '2.5', max: '10' }), {
      category: 'produce',
      onSale: true,
    })
    expect(q).toMatchObject({
      minPriceCents: 250,
      maxPriceCents: 1000,
      category: 'produce',
      onSale: true,
      limit: 24,
    })
  })

  it('builds links that reset the page and keep the rest', () => {
    const s = parseListing({ q: 'milk', organic: '1', page: '4' })
    expect(hrefWith('/shop', s, { sort: 'name' })).toBe('/shop?q=milk&organic=1&sort=name')
    expect(hrefWith('/shop', s, { page: 5 })).toBe('/shop?q=milk&organic=1&page=5')
  })
})

describe('display helpers', () => {
  it('labels claims and days', () => {
    expect(claimLabel('glutenFree')).toBe('Gluten free')
    expect(claimLabel('sesameFree')).toBe('Sesame free')
    expect(formatDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat')
    expect(formatDays([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(formatDays([])).toBeNull()
  })
})
