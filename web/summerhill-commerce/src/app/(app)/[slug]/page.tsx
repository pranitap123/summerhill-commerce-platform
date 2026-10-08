import { notFound, permanentRedirect } from 'next/navigation'

import { getProductPage } from '../_lib/catalog'

export default async function LegacyProductUrl({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getProductPage(decodeURIComponent(slug)).catch(() => null)
  if (!found) notFound()
  permanentRedirect(`/products/${found.product.slug}`)
}
