import Link from 'next/link'

import { ProductGrid } from '@/components/storefront/ProductCard'
import type { CategoryNode, MerchantStorefront, ProductSummary } from '@/modules/catalog'

export default function HomeContent({
  categories,
  specials,
  merchants,
}: {
  categories: CategoryNode[] | null
  specials: ProductSummary[] | null
  merchants: MerchantStorefront[] | null
}) {
  return (
    <>
      <section className="relative overflow-hidden bg-[#1F3A2E] px-4 py-16 text-[#FAF6EE] md:py-24">
        <div className="container relative z-10 max-w-3xl">
          <p className="mb-3 font-medium tracking-wide text-[#E0B350]">Grocery Marketplace Demo</p>
          <h1 className="font-display mb-6 text-4xl font-semibold leading-[1.05] md:text-6xl">
            Your local grocers, one basket.
          </h1>
          <p className="mb-8 max-w-md text-lg text-[#DCE5D8]">
            Order from independent stores and pick up when it suits you. Weighed items are charged
            by their actual weight.
          </p>
          <form action="/shop" method="get" role="search" className="flex max-w-lg gap-2">
            <label htmlFor="home-q" className="sr-only">
              Search products
            </label>
            <input
              id="home-q"
              name="q"
              type="search"
              maxLength={100}
              placeholder="Search apples, sourdough, salmon…"
              className="min-w-0 flex-1 rounded-full bg-white px-5 py-3 text-[#211F1C] placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C9962C]"
            />
            <button
              type="submit"
              className="rounded-full bg-[#C9962C] px-6 py-3 font-medium text-[#211F1C] hover:bg-[#E0B350]"
            >
              Search
            </button>
          </form>
        </div>
        <div
          aria-hidden="true"
          className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-[#C9962C]/20 blur-3xl"
        />
      </section>

      <section aria-labelledby="categories-heading" className="container py-12">
        <h2 id="categories-heading" className="font-display mb-6 text-3xl text-[#1F3A2E]">
          Shop by category
        </h2>
        {categories === null ? (
          <p role="alert">Categories are unavailable right now.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/shop/${c.slug}`}
                  className="flex h-full flex-col justify-between rounded-2xl bg-[#DCE5D8] p-4 text-[#1F3A2E] transition-colors hover:bg-[#C9962C] hover:text-[#211F1C]"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm">{c.productCount} products</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {specials && specials.length > 0 && (
        <section aria-labelledby="specials-heading" className="container pb-12">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 id="specials-heading" className="font-display text-3xl text-[#1F3A2E]">
              This week&apos;s specials
            </h2>
            <Link href="/specials" className="text-sm font-medium text-[#1F3A2E] underline">
              See all specials
            </Link>
          </div>
          <ProductGrid products={specials} label="Specials" />
        </section>
      )}

      {merchants && merchants.length > 0 && (
        <section aria-labelledby="stores-heading" className="container pb-16">
          <h2 id="stores-heading" className="font-display mb-6 text-3xl text-[#1F3A2E]">
            Stores
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {merchants.map((m) => (
              <li key={m.slug} className="rounded-2xl bg-white p-6 shadow-sm">
                <Link
                  href={`/stores/${m.slug}`}
                  className="font-display text-xl text-[#1F3A2E] hover:underline"
                >
                  {m.name}
                </Link>
                <p className="text-sm text-neutral-700">
                  {m.productCount} products · pickup in{' '}
                  {m.locations
                    .map((l) => l.city)
                    .filter(Boolean)
                    .join(', ') || 'store'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
