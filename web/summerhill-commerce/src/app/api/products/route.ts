import { findProducts } from '@/modules/search'
import { parseQuery, route } from '@/server/http'

import { browseQuery } from '../v1/_lib/schemas'
import { deprecated } from './deprecated'

/** Deprecated alias of GET /api/v1/products. */
export const GET = route('public', async ({ req }) =>
  deprecated(await findProducts(parseQuery(req, browseQuery)), '/api/v1/products'),
)
