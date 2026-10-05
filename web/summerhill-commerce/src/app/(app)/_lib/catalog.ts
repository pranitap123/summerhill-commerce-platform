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

/**
 * Storefront reads (G3-13). Server Components call the module services directly (SYSTEM_DESIGN
 * §7.1) through these cached wrappers: tagged `catalog` / `product:<id>` so the worker can
 * revalidate them on `product.changed`, with a time-based fallback. Text searches are never cached
 * (each one is logged for analytics).
 */
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

/** Slug → product id (changes only on rename, i.e. with an ingest: tag `catalog`). */
const resolveSlug = cached('slug', async (param: string) => {
  const found = await resolveProduct(param)
  return found ? { id: found.product.id, slug: found.product.slug } : null
})

const productById = cached(
  'product',
  async (id: string): Promise<ProductSummary | null> => (await getProductsByIds([id]))[0] ?? null,
  (id) => [CATALOG_TAG, productTag(id)],
)

/** PDP lookup: the product plus whether the URL isn't its current slug (→ 301). */
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
