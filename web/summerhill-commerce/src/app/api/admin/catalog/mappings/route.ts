import { listCategoryMappings, listSubcategories } from '@/modules/catalog'
import { parseQuery, route } from '@/server/http'

import { mappingQuery } from '../../_lib/schemas'

/** GET /api/admin/catalog/mappings?unmapped=true: source categories and our subcategories. */
export const GET = route(
  'admin',
  async ({ req }) => {
    const { unmapped } = parseQuery(req, mappingQuery)
    const [mappings, subcategories] = await Promise.all([
      listCategoryMappings(unmapped === 'true'),
      listSubcategories(),
    ])
    return { mappings, subcategories }
  },
  { permission: 'catalog.manage' },
)
