import { z } from 'zod'

import { searchReport } from '@/modules/search'
import { parseQuery, route } from '@/server/http'

const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict()

export const GET = route('admin', async ({ req }) => searchReport(parseQuery(req, query).days))
