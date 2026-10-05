import type { MetadataRoute } from 'next'

import { listCategories, listMerchants, listProductSlugs } from '@/modules/catalog'
import { getConfig } from '@/server/config'

export const revalidate = 3600

/** sitemap.xml (G3-16): storefront pages, categories, stores and every visible product. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getConfig().NEXT_PUBLIC_SERVER_URL
  const url = (path: string) => new URL(path, base).toString()
  const [categories, merchants, products] = await Promise.all([
    listCategories().catch(() => []),
    listMerchants().catch(() => []),
    listProductSlugs().catch(() => []),
  ])
  return [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/shop'), changeFrequency: 'daily', priority: 0.9 },
    { url: url('/specials'), changeFrequency: 'daily', priority: 0.8 },
    { url: url('/stores'), changeFrequency: 'weekly', priority: 0.5 },
    ...categories.map((c) => ({
      url: url(`/shop/${c.slug}`),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
    ...merchants.map((m) => ({
      url: url(`/stores/${m.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...products.map((p) => ({
      url: url(`/products/${p.slug}`),
      lastModified: p.updatedAt,
      priority: 0.5,
    })),
  ]
}
