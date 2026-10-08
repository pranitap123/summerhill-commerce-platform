import { resolveProduct } from '@/modules/catalog'
import { HttpError, parseParams, route } from '@/server/http'

import { productParams } from '../../v1/_lib/schemas'
import { deprecated } from '../deprecated'

export const GET = route<{ id: string }>('public', async ({ params }) => {
  const { slug } = parseParams({ slug: (await params).id }, productParams)
  const found = await resolveProduct(slug)
  if (!found) throw new HttpError(404, 'NOT_FOUND', 'Product not found')
  return deprecated(
    { product: found.product, canonicalSlug: found.product.slug },
    `/api/v1/products/${encodeURIComponent(found.product.slug)}`,
  )
})
