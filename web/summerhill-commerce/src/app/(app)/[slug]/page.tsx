import { notFound, permanentRedirect } from 'next/navigation'

import { getProductPage } from '../_lib/catalog'

/**
 * Stage-3 product URLs were `/<product id>`. They now answer with a 301 to the canonical
 * `/products/<slug>` (G3-13); anything else is a 404.
 */
export default async function LegacyProductUrl({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getProductPage(decodeURIComponent(slug)).catch(() => null)
  if (!found) notFound()
  permanentRedirect(`/products/${found.product.slug}`)
}
