import type { ProductSummary } from '@/modules/catalog'

/** One browse or search request (CATALOG §8.3). Browse = no `q`. */
export interface CatalogQuery {
  q?: string
  merchant?: string
  category?: string
  subcategory?: string
  organic?: boolean
  onSale?: boolean
  /** Every listed claim must be present (as supplied by the merchant). */
  dietary?: string[]
  minPriceCents?: number
  maxPriceCents?: number
  inStock?: boolean
  sort: 'relevance' | 'price_asc' | 'price_desc' | 'name'
  page: number
  limit: number
}

export interface FacetValue {
  slug: string
  name: string
  count: number
}

/**
 * Drill-down facets. Each count is the number of results you'd get by adding that value to the
 * current filters; the category facet ignores the current category (so you can switch), and the
 * subcategory facet ignores the current subcategory.
 */
export interface Facets {
  categories: FacetValue[]
  subcategories: FacetValue[]
  organic: number
  onSale: number
  dietary: Array<{ claim: string; count: number }>
  price: { minCents: number; maxCents: number } | null
}

export type SearchEngine = 'elasticsearch' | 'postgres'

export interface CatalogPage {
  engine: SearchEngine
  total: number
  page: number
  limit: number
  items: ProductSummary[]
  facets: Facets
  /** Set for logged text searches; send it back with clicks (analytics, no PII). */
  searchId: string | null
  tookMs: number
}

/** What each engine returns: ranked ids (hydrated from Postgres afterwards) and facets. */
export interface EngineResult {
  ids: string[]
  total: number
  facets: Facets
}

export const MAX_QUERY_LENGTH = 100
export const MAX_LIMIT = 50
