import { z } from 'zod'

import { searchReport } from '@/modules/search'
import { parseQuery, route } from '@/server/http'

const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict()

/** GET /api/admin/search/report?days=7: top and zero-result queries, click positions (G3-15). */
export const GET = route('admin', async ({ req }) => searchReport(parseQuery(req, query).days))
