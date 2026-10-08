import { listIngestRequests, listIngestRuns, requestIngestRun } from '@/modules/catalog'
import { parseJson, parseQuery, route } from '@/server/http'
import { z } from 'zod'

import { ingestRunBody } from '../../_lib/schemas'

const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict()

export const GET = route(
  'admin',
  async ({ req }) => {
    const { limit } = parseQuery(req, query)
    const [runs, requests] = await Promise.all([listIngestRuns(limit), listIngestRequests(limit)])
    return { runs, requests }
  },
  { permission: 'catalog.manage' },
)

export const POST = route(
  'admin',
  async ({ req, auditContext }) => {
    const { merchantId, mode } = await parseJson(req, ingestRunBody)
    const requestId = await requestIngestRun(auditContext, merchantId, mode)
    return Response.json({ requestId, status: 'pending' }, { status: 202 })
  },
  { permission: 'catalog.manage', audit: 'service' },
)
