import type { Metadata } from 'next'

import { parseListing, type RawParams } from '@/components/storefront/params'

import { AsyncListing } from '../_lib/AsyncListing'

type Props = { searchParams: Promise<RawParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = parseListing(await searchParams)
  return {
    title: q ? `Search: ${q}` : 'Shop all groceries',
    description:
      'Browse and search every product, with filters for category, price, organic, specials and dietary needs.',
    alternates: { canonical: '/shop' },

    robots: q ? { index: false, follow: true } : undefined,
  }
}

export default async function ShopPage({ searchParams }: Props) {
  const raw = await searchParams

  const state = parseListing(raw)
  return (
    <AsyncListing
      base="/shop"
      state={state}
      title={state.q ? 'Search results' : 'Shop all groceries'}
    />
  )
}
