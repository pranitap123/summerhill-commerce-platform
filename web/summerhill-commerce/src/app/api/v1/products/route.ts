import { findProducts } from '@/modules/search'
import { parseQuery, route } from '@/server/http'

import { browseQuery } from '../_lib/schemas'

export const GET = route('public', async ({ req }) => findProducts(parseQuery(req, browseQuery)))
