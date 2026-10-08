import { getProductsByIds, suggestReplacements } from '@/modules/catalog'
import { consoleOrder } from '@/modules/fulfilment'
import { HttpError, parseParams, route } from '@/server/http'

import { scopeOf } from '../../../../../_lib/scope'
import { lineParams } from '../../../../../_lib/schemas'

export const GET = route<{ publicId: string; lineId: string }>('staff', async (ctx) => {
  const { publicId, lineId } = parseParams(ctx.params, lineParams)
  const order = await consoleOrder(scopeOf(ctx), publicId)
  const line = order.lines.find((l) => l.id === lineId)
  if (!line) throw new HttpError(404, 'NOT_FOUND', 'Line not found on this order')
  const products =
    line.replacementPreference === 'refund'
      ? []
      : line.replacementPreference === 'specific'
        ? await getProductsByIds(line.replacementProducts.map((p) => p.id))
        : await suggestReplacements(line.productId, 6)
  return {
    preference: line.replacementPreference,
    options: products
      .filter((p) => p.isVisible && p.availability === 'in_stock')
      .map((p) => ({
        productId: p.id,
        name: p.name,
        upc: p.upc,
        image: p.images[0] ?? null,
        unit: p.unit,
        sellBy: p.sellBy,
        effectivePriceCents: p.effectivePriceCents,
        taxable: p.taxCode === 'HST_STANDARD',
      })),
  }
})
