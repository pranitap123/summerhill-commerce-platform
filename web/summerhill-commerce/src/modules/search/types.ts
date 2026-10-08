import type { ProductSummary } from '@/modules/catalog'

export interface CatalogQuery {
  q?: string
  merchant?: string
  category?: string
  subcategory?: string
  organic?: boolean
  onSale?: boolean

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

  searchId: string | null
  tookMs: number
}

export interface EngineResult {
  ids: string[]
  total: number
  facets: Facets
}

export const MAX_QUERY_LENGTH = 100
export const MAX_LIMIT = 50
