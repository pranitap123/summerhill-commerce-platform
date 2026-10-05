import type { Metadata } from 'next'
import Link from 'next/link'

import { formatCad } from '@/utilities/money'

import { getMerchants } from '../_lib/catalog'

export const metadata: Metadata = {
  title: 'Stores',
  description: 'Independent grocers on the marketplace and where to pick up your order.',
  alternates: { canonical: '/stores' },
}

/** /stores: every merchant on the storefront (G3-13). */
export default async function StoresPage() {
  const merchants = await getMerchants().catch(() => null)
  return (
    <div className="container py-8 md:py-12">
      <h1 className="font-display mb-6 text-3xl text-[#1F3A2E] md:text-4xl">Stores</h1>
      {!merchants ? (
        <p role="alert" className="rounded-xl bg-white p-6">
          We couldn&apos;t load stores right now.
        </p>
      ) : merchants.length === 0 ? (
        <p className="rounded-xl bg-white p-6">No stores are open on the marketplace yet.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {merchants.map((m) => (
            <li key={m.slug} className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="font-display mb-1 text-2xl text-[#1F3A2E]">
                <Link href={`/stores/${m.slug}`} className="hover:underline">
                  {m.name}
                </Link>
              </h2>
              <p className="mb-3 text-sm text-neutral-700">
                {m.productCount} products · minimum order {formatCad(m.minOrderCents)}
                {!m.acceptingOrders && ' · not taking orders right now'}
              </p>
              {m.locations.map((l) => (
                <address key={l.slug} className="text-sm not-italic text-[#211F1C]">
                  Pickup: {l.name},{' '}
                  {[l.addressLine1, l.city, l.province].filter(Boolean).join(', ')}
                </address>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
