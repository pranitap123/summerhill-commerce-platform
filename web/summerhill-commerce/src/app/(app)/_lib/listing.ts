import { findProducts, type CatalogPage } from '@/modules/search'
import { toQuery, type ListingState } from '@/components/storefront/params'
import { getLogger } from '@/server/logger'

import { browse } from './catalog'

/**
 * Loads one listing page. Browsing is cached (tag `catalog`); text searches run live because each
 * one is logged for analytics. Errors become `null` so the page shows its error state instead of
 * crashing (the pre-G3 shop page crashed on any API error).
 */
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
