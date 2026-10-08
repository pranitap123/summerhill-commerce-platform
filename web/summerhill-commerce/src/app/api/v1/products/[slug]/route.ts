import { resolveProduct } from '@/modules/catalog'
import { HttpError, parseParams, route } from '@/server/http'

import { productParams } from '../../_lib/schemas'

export const GET = route<{ slug: string }>('public', async ({ params }) => {
  const { slug } = parseParams(params, productParams)
  const found = await resolveProduct(slug)
  if (!found) throw new HttpError(404, 'NOT_FOUND', 'Product not found')
  return { product: found.product, canonicalSlug: found.product.slug }
})
