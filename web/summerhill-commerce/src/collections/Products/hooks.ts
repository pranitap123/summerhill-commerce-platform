import type { CollectionAfterChangeHook } from 'payload'

import { clearProductOverride, setProductOverride } from '@/modules/catalog'

/** Set by the catalogue sync so its own writes don't bounce back into the catalogue. */
export const FROM_SYNC = 'fromCatalogSync'

/**
 * Admin edits become catalogue overrides (ingest never overwrites them). A title equal to the
 * source name and "in stock" mean no override at all, so the row is removed again.
 */
export const pushOverrideToCatalog: CollectionAfterChangeHook = async ({ doc, req }) => {
  if (req.context?.[FROM_SYNC]) return doc
  const renamed = doc.title && doc.title !== doc.sourceName ? doc.title : null
  const hidden = doc.stockStatus === 'out_of_stock'
  const actor = { type: 'admin' as const, id: req.user ? String(req.user.id) : null }
  if (!renamed && !hidden) await clearProductOverride(doc.productId, actor)
  else await setProductOverride(doc.productId, { name: renamed, hidden }, actor)
  return doc
}
