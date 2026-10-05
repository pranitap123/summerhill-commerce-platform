import { decideHeldRun } from '@/modules/catalog'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { ingestDecisionBody } from '../../../../_lib/schemas'

/**
 * POST /api/admin/catalog/ingest-runs/{id}/decision (G5-14): a held run is rejected at once, or
 * approval is requested from the pipeline, which applies the staged feed as ingest_rw.
 */
export const POST = route<{ id: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const { decision } = await parseJson(req, ingestDecisionBody)
    return decideHeldRun(auditContext, id, decision)
  },
  { permission: 'catalog.manage', audit: 'service' },
)
