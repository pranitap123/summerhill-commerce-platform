import { getDb } from '@/server/db'
import { parseQuery, route } from '@/server/http'

import { productSearchQuery } from '../_lib/schemas'

export const GET = route(
  'admin',
  async ({ req }) => {
    const { q, limit } = parseQuery(req, productSearchQuery)
    const { rows } = await getDb().query(
      `SELECT v.id, v.name, v.source_name, v.merchant_slug, v.category, v.subcategory, v.subcategory_id,
         v.unit_price_cents, v.upc, v.is_visible, v.hidden, v.hidden_until, v.blocked_reason,
         o.product_id IS NOT NULL AS has_override, o.updated_by AS override_by
       FROM catalog.product_view v LEFT JOIN catalog.product_overrides o ON o.product_id = v.id
       WHERE v.deleted_at IS NULL AND (v.id = $1 OR v.upc = $1 OR v.name ILIKE '%' || $1 || '%')
       ORDER BY v.name LIMIT $2`,
      [q, limit],
    )
    return { products: rows }
  },
  { permission: 'catalog.manage' },
)
