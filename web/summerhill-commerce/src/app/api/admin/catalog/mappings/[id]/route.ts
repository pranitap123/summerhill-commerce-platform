import { setCategoryMapping } from '@/modules/catalog'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { mappingBody } from '../../../_lib/schemas'

/** PUT /api/admin/catalog/mappings/{id}: map a source category; a full re-run is requested. */
export const PUT = route<{ id: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { id } = parseParams(params, idParam)
    const { subcategoryId } = await parseJson(req, mappingBody)
    return setCategoryMapping(auditContext, id, subcategoryId)
  },
  { permission: 'catalog.manage', audit: 'service' },
)
