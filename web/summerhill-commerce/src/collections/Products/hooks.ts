import type { CollectionAfterChangeHook } from 'payload'

import { clearProductOverride, setProductOverride } from '@/modules/catalog'

export const FROM_SYNC = 'fromCatalogSync'

export const pushOverrideToCatalog: CollectionAfterChangeHook = async ({ doc, req }) => {
  if (req.context?.[FROM_SYNC]) return doc
  const renamed = doc.title && doc.title !== doc.sourceName ? doc.title : null
  const hidden = doc.stockStatus === 'out_of_stock'
  const actor = { type: 'admin' as const, id: req.user ? String(req.user.id) : null }
  if (!renamed && !hidden) await clearProductOverride(doc.productId, actor)
  else await setProductOverride(doc.productId, { name: renamed, hidden }, actor)
  return doc
}
