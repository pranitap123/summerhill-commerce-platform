// Public API of the search module (search v2, G3-08; analytics, G3-15).
export { findProducts } from './service'
export {
  getSearchClient,
  elasticSearch,
  resetSearchClientForTests,
  pingSearch,
  rebuildSearchIndex,
  upsertSearchDocuments,
  searchIndexExists,
  buildSearchRequest,
  INDEX_MAPPINGS,
  INDEX_SETTINGS,
} from './elastic'
export type { RebuildResult } from './elastic'
export { postgresSearch } from './postgres'
export { logSearch, recordSearchClick, searchReport, normaliseQuery } from './analytics'
export type { SearchReport } from './analytics'
export { SYNONYMS, expandTerm, queryTerms } from './synonyms'
export type { CatalogQuery, CatalogPage, Facets, FacetValue, SearchEngine } from './types'
export { MAX_LIMIT, MAX_QUERY_LENGTH } from './types'
