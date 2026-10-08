import { findProducts, type CatalogPage } from '@/modules/search'
import { toQuery, type ListingState } from '@/components/storefront/params'
import { getLogger } from '@/server/logger'

import { browse } from './catalog'

export async function loadListing(
  state: ListingState,
  fixed: Parameters<typeof toQuery>[1] = {},
): Promise<CatalogPage | null> {
  const query = toQuery(state, fixed)
  try {
    return query.q ? await findProducts(query) : await browse(query)
  } catch (err) {
    getLogger().error({ err }, 'storefront: listing failed')
    return null
  }
}
