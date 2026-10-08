import { decideHeldRun } from '@/modules/catalog'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { ingestDecisionBody } from '../../../../_lib/schemas'

export const POST = route<{ id: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const { decision } = await parseJson(req, ingestDecisionBody)
    return decideHeldRun(auditContext, id, decision)
  },
  { permission: 'catalog.manage', audit: 'service' },
)
