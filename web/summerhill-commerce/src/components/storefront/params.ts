import type { CatalogQuery } from '@/modules/search'

export type RawParams = Record<string, string | string[] | undefined>

export interface ListingState {
  q: string
  subcategory?: string
  organic: boolean
  onSale: boolean
  inStock: boolean
  dietary: string[]
  min?: string
  max?: string
  sort: CatalogQuery['sort']
  page: number
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CLAIM = /^[A-Za-z0-9_-]{1,40}$/
const SORTS = ['relevance', 'price_asc', 'price_desc', 'name'] as const
export const PAGE_SIZE = 24

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const all = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]
const on = (v: string | string[] | undefined) => first(v) === '1' || first(v) === 'true'
const dollars = (v: string | undefined) =>
  v !== undefined && /^\d{1,5}(\.\d{1,2})?$/.test(v.trim()) ? v.trim() : undefined

export function parseListing(params: RawParams): ListingState {
  const sort = first(params.sort)
  const page = Number(first(params.page))
  const sub = first(params.sub)
  return {
    q: (first(params.q) ?? '').trim().slice(0, 100),
    subcategory: sub && SLUG.test(sub) ? sub : undefined,
    organic: on(params.organic),
    onSale: on(params.sale),
    inStock: on(params.stock),
    dietary: [...new Set(all(params.diet).filter((c) => CLAIM.test(c)))].slice(0, 10),
    min: dollars(first(params.min)),
    max: dollars(first(params.max)),
    sort: (SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as CatalogQuery['sort'])
      : 'relevance',
    page: Number.isInteger(page) && page >= 1 && page <= 200 ? page : 1,
  }
}

export function toQuery(
  s: ListingState,
  fixed: Partial<Pick<CatalogQuery, 'category' | 'merchant' | 'onSale'>> = {},
): CatalogQuery {
  const cents = (d?: string) => (d === undefined ? undefined : Math.round(Number(d) * 100))
  return {
    q: s.q || undefined,
    category: fixed.category,
    merchant: fixed.merchant,
    subcategory: s.subcategory,
    organic: s.organic || undefined,
    onSale: fixed.onSale || s.onSale || undefined,
    inStock: s.inStock || undefined,
    dietary: s.dietary.length ? s.dietary : undefined,
    minPriceCents: cents(s.min),
    maxPriceCents: cents(s.max),
    sort: s.sort,
    page: s.page,
    limit: PAGE_SIZE,
  }
}

export function hrefWith(
  base: string,
  s: ListingState,
  change: Partial<ListingState> = {},
): string {
  const next = { ...s, page: 1, ...change }
  const p = new URLSearchParams()
  if (next.q) p.set('q', next.q)
  if (next.subcategory) p.set('sub', next.subcategory)
  if (next.organic) p.set('organic', '1')
  if (next.onSale) p.set('sale', '1')
  if (next.inStock) p.set('stock', '1')
  for (const d of next.dietary) p.append('diet', d)
  if (next.min) p.set('min', next.min)
  if (next.max) p.set('max', next.max)
  if (next.sort !== 'relevance') p.set('sort', next.sort)
  if (next.page > 1) p.set('page', String(next.page))
  const qs = p.toString()
  return qs ? `${base}?${qs}` : base
}

export const hasFilters = (s: ListingState) =>
  !!(s.subcategory || s.organic || s.onSale || s.inStock || s.dietary.length || s.min || s.max)
