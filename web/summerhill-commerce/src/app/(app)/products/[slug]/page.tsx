import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { ProductDetail } from '@/components/ProductDetail'
import { getConfig } from '@/server/config'

import { getProductPage } from '../../_lib/catalog'

type Props = { params: Promise<{ slug: string }> }

async function load(params: Props['params']) {
  const { slug } = await params
  return getProductPage(decodeURIComponent(slug)).catch(() => null)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params)
  if (!found) return { title: 'Product not found' }
  const { product } = found
  const description = (
    product.description || `${product.name} from ${product.merchantName}.`
  ).slice(0, 160)
  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      images: product.images.slice(0, 1),
      type: 'website',
    },
  }
}

/**
 * /products/{slug} (G3-10). Old slugs (after a rename) and legacy id URLs answer with a 301 to the
 * current slug (G3-13); hidden or unknown products are 404.
 */
export default async function ProductPage({ params }: Props) {
  const found = await load(params)
  if (!found) notFound()
  if (found.redirect) permanentRedirect(`/products/${found.product.slug}`)
  return <ProductDetail product={found.product} baseUrl={getConfig().NEXT_PUBLIC_SERVER_URL} />
}
