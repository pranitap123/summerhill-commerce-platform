import type { Metadata } from 'next'

import HomeContent from '@/components/HomeContent'

import { browse, getCategories, getMerchants } from './_lib/catalog'

export const metadata: Metadata = { alternates: { canonical: '/' } }

export default async function HomePage() {
  const [categories, specials, merchants] = await Promise.all([
    getCategories().catch(() => null),
    browse({ onSale: true, inStock: true, sort: 'relevance', page: 1, limit: 8 })
      .then((r) => r.items)
      .catch(() => null),
    getMerchants().catch(() => null),
  ])
  return <HomeContent categories={categories} specials={specials} merchants={merchants} />
}
