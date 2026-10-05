import { findProducts } from '@/modules/search'
import { parseQuery, route } from '@/server/http'

import { browseQuery } from '../_lib/schemas'

/** GET /api/v1/products: browse with filters and facets (G3-09). Text search is /api/v1/search. */
export const GET = route('public', async ({ req }) => findProducts(parseQuery(req, browseQuery)))
