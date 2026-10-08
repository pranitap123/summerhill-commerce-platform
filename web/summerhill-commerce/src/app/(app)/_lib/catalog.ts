import { unstable_cache } from 'next/cache'

import {
  getProductsByIds,
  listCategories,
  listMerchants,
  resolveProduct,
  type ProductSummary,
} from '@/modules/catalog'
import { findProducts, type CatalogQuery } from '@/modules/search'
import { CATALOG_REVALIDATE_SECONDS, CATALOG_TAG, productTag } from '@/server/revalidate'

const cached =
  <A extends unknown[], R>(
    key: string,
    fn: (...args: A) => Promise<R>,
    tags: (...args: A) => string[] = () => [CATALOG_TAG],
  ) =>
  (...args: A): Promise<R> =>
    unstable_cache(() => fn(...args), [key, JSON.stringify(args)], {
      tags: tags(...args),
      revalidate: CATALOG_REVALIDATE_SECONDS,
    })()

export const getCategories = cached('categories', listCategories)
export const getMerchants = cached('merchants', (slug?: string) => listMerchants(slug))

export const browse = cached('browse', (query: CatalogQuery) => findProducts(query, { log: false }))

const resolveSlug = cached('slug', async (param: string) => {
  const found = await resolveProduct(param)
  return found ? { id: found.product.id, slug: found.product.slug } : null
})

const productById = cached(
  'product',
  async (id: string): Promise<ProductSummary | null> => (await getProductsByIds([id]))[0] ?? null,
  (id) => [CATALOG_TAG, productTag(id)],
)

export async function getProductPage(
  param: string,
): Promise<{ product: ProductSummary; redirect: boolean } | null> {
  const ref = await resolveSlug(param)
  if (!ref) return null
  const product = await productById(ref.id)
  if (!product || !product.isVisible) return null
  return { product, redirect: ref.slug !== param }
}

export const categoryBySlug = async (slug: string) =>
  (await getCategories()).find((c) => c.slug === slug) ?? null
