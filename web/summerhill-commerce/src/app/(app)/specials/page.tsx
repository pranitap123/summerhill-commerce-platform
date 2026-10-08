import type { Metadata } from 'next'

import { parseListing, type RawParams } from '@/components/storefront/params'

import { AsyncListing } from '../_lib/AsyncListing'

export const metadata: Metadata = {
  title: 'Specials',
  description: "This week's sale prices across every store.",
  alternates: { canonical: '/specials' },
}

export default async function SpecialsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const state = parseListing(await searchParams)
  return (
    <AsyncListing
      fixed={{ onSale: true }}
      base="/specials"
      state={state}
      title="Specials"
      searchable={false}
      lockedOnSale
      intro={
        <p className="text-neutral-700">
          Sale prices while stocks last. The regular price is shown struck through.
        </p>
      }
    />
  )
}
