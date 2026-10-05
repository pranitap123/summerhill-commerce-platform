import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { parseListing, type RawParams } from '@/components/storefront/params'
import { formatCad } from '@/utilities/money'

import { getMerchants } from '../../_lib/catalog'
import { AsyncListing } from '../../_lib/AsyncListing'

type Props = { params: Promise<{ merchant: string }>; searchParams: Promise<RawParams> }

async function merchantBySlug(slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null
  return (await getMerchants(slug))[0] ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = await merchantBySlug((await params).merchant)
  if (!m) return { title: 'Store not found' }
  return {
    title: m.name,
    description: `Shop ${m.productCount} products from ${m.name} for pickup.`,
    alternates: { canonical: `/stores/${m.slug}` },
  }
}

/** /stores/{merchant}: a merchant's page with its pickup location and catalogue (G3-13). */
export default async function MerchantPage({ params, searchParams }: Props) {
  const m = await merchantBySlug((await params).merchant)
  if (!m) notFound()
  const state = parseListing(await searchParams)
  return (
    <AsyncListing
      fixed={{ merchant: m.slug }}
      base={`/stores/${m.slug}`}
      state={state}
      title={m.name}
      intro={
        <div className="space-y-1 text-sm text-neutral-700">
          <p>
            <Link href="/stores" className="underline">
              All stores
            </Link>{' '}
            · minimum order {formatCad(m.minOrderCents)}
            {!m.acceptingOrders && ' · not taking orders right now'}
          </p>
          {m.locations.map((l) => (
            <address key={l.slug} className="not-italic">
              Pickup at {l.name}:{' '}
              {[l.addressLine1, l.city, l.province, l.postalCode].filter(Boolean).join(', ')}
            </address>
          ))}
        </div>
      }
    />
  )
}
