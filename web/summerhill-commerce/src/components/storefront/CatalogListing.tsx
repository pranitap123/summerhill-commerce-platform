import Link from 'next/link'

import type { CatalogPage } from '@/modules/search'
import { formatCad } from '@/utilities/money'

import { claimLabel, DIETARY_DISCLAIMER } from './format'
import { hasFilters, hrefWith, PAGE_SIZE, type ListingState } from './params'
import { ProductGrid } from './ProductCard'
import { SortSelect } from './SortSelect'

/**
 * The shared product listing (G3-09, G3-13): search box, facet filters, sort, results, pagination,
 * and empty/error states. Filters are a plain GET form, so it works without JavaScript; the URL is
 * the state, so every view can be shared and cached.
 */
export function CatalogListing({
  base,
  state,
  result,
  title,
  intro,
  categoryLinks = true,
  searchable = true,
  lockedOnSale = false,
}: {
  base: string
  state: ListingState
  result: CatalogPage | null
  title: string
  intro?: React.ReactNode
  categoryLinks?: boolean
  searchable?: boolean
  lockedOnSale?: boolean
}) {
  const sortHrefs = Object.fromEntries(
    (['relevance', 'price_asc', 'price_desc', 'name'] as const).map((s) => [
      s,
      hrefWith(base, state, { sort: s }),
    ]),
  )
  const pages = result ? Math.min(200, Math.ceil(result.total / PAGE_SIZE)) : 0

  return (
    <div className="container py-8 md:py-12">
      <header className="mb-6">
        <h1 className="font-display mb-2 text-3xl text-[#1F3A2E] md:text-4xl">{title}</h1>
        {intro}
      </header>

      {searchable && (
        <form action={base} method="get" role="search" className="mb-6 flex gap-2">
          <label htmlFor="listing-q" className="sr-only">
            Search products
          </label>
          <input
            id="listing-q"
            name="q"
            type="search"
            defaultValue={state.q}
            maxLength={100}
            placeholder="Search products, brands…"
            className="min-w-0 flex-1 rounded-full border border-[#DCE5D8] bg-white px-5 py-2.5 text-[#211F1C] focus:outline-none focus:ring-2 focus:ring-[#C9962C]"
          />
          <button
            type="submit"
            className="rounded-full bg-[#1F3A2E] px-5 py-2.5 font-medium text-white hover:bg-[#2c5140]"
          >
            Search
          </button>
        </form>
      )}

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        {result && (
          <Filters
            base={base}
            state={state}
            result={result}
            categoryLinks={categoryLinks}
            lockedOnSale={lockedOnSale}
          />
        )}

        <section aria-labelledby="results-heading" className="min-w-0">
          {!result ? (
            <p role="alert" className="rounded-xl bg-white p-6 text-[#211F1C]">
              We couldn&apos;t load products right now. Please try again in a moment.
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 id="results-heading" className="text-sm text-neutral-700" aria-live="polite">
                  {result.total === 1 ? '1 product' : `${result.total} products`}
                  {state.q && (
                    <>
                      {' '}
                      for <strong>&ldquo;{state.q}&rdquo;</strong>
                    </>
                  )}
                </h2>
                <SortSelect value={state.sort} hrefs={sortHrefs} />
              </div>

              {result.items.length === 0 ? (
                <EmptyState base={base} state={state} />
              ) : (
                <ProductGrid
                  products={result.items}
                  searchId={result.searchId}
                  offset={(state.page - 1) * PAGE_SIZE}
                  label="Products"
                />
              )}

              {pages > 1 && <Pagination base={base} state={state} pages={pages} />}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Filters({
  base,
  state,
  result,
  categoryLinks,
  lockedOnSale,
}: {
  base: string
  state: ListingState
  result: CatalogPage
  categoryLinks: boolean
  lockedOnSale: boolean
}) {
  const { facets } = result
  const checkbox = (name: string, checked: boolean, label: string, count?: number) => (
    <label key={name} className="flex items-center gap-2 py-1 text-sm text-[#211F1C]">
      <input
        type="checkbox"
        name={name.split(':')[0]}
        value={name.split(':')[1] ?? '1'}
        defaultChecked={checked}
        className="h-4 w-4 accent-[#1F3A2E]"
      />
      <span>
        {label}
        {count !== undefined && <span className="text-neutral-600"> ({count})</span>}
      </span>
    </label>
  )
  const panel = (id: string) => (
    <div className="space-y-6">
      {categoryLinks && facets.categories.length > 0 && (
        <nav aria-label="Categories">
          <h3 className="mb-2 text-sm font-semibold text-[#1F3A2E]">Category</h3>
          <ul className="space-y-1 text-sm">
            {facets.categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={hrefWith(`/shop/${c.slug}`, { ...state, subcategory: undefined })}
                  className="text-[#211F1C] hover:underline"
                >
                  {c.name} <span className="text-neutral-600">({c.count})</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {facets.subcategories.length > 0 && (
        <nav aria-label="Subcategories">
          <h3 className="mb-2 text-sm font-semibold text-[#1F3A2E]">Type</h3>
          <ul className="space-y-1 text-sm">
            {facets.subcategories.map((s) => {
              const current = state.subcategory === s.slug
              return (
                <li key={s.slug}>
                  <Link
                    href={hrefWith(base, state, { subcategory: current ? undefined : s.slug })}
                    aria-current={current ? 'true' : undefined}
                    className={
                      current
                        ? 'font-semibold text-[#1F3A2E] underline'
                        : 'text-[#211F1C] hover:underline'
                    }
                  >
                    {s.name} <span className="text-neutral-600">({s.count})</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      <form action={base} method="get" className="space-y-5">
        {state.q && <input type="hidden" name="q" value={state.q} />}
        {state.subcategory && <input type="hidden" name="sub" value={state.subcategory} />}
        {state.sort !== 'relevance' && <input type="hidden" name="sort" value={state.sort} />}
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-[#1F3A2E]">Show</legend>
          {checkbox('organic', state.organic, 'Organic', facets.organic)}
          {!lockedOnSale && checkbox('sale', state.onSale, 'On sale', facets.onSale)}
          {checkbox('stock', state.inStock, 'Available now')}
        </fieldset>

        {facets.dietary.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-[#1F3A2E]">Dietary</legend>
            {facets.dietary.map((d) =>
              checkbox(
                `diet:${d.claim}`,
                state.dietary.includes(d.claim),
                claimLabel(d.claim),
                d.count,
              ),
            )}
            <p className="mt-2 text-xs text-neutral-600">{DIETARY_DISCLAIMER}</p>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-[#1F3A2E]">Price</legend>
          {facets.price && (
            <p className="mb-2 text-xs text-neutral-600">
              {formatCad(facets.price.minCents)} – {formatCad(facets.price.maxCents)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-price-min`}>
              Minimum price in dollars
            </label>
            <input
              id={`${id}-price-min`}
              name="min"
              inputMode="decimal"
              defaultValue={state.min}
              placeholder="Min $"
              className="w-20 rounded border border-[#DCE5D8] bg-white px-2 py-1 text-sm"
            />
            <span aria-hidden="true">–</span>
            <label className="sr-only" htmlFor={`${id}-price-max`}>
              Maximum price in dollars
            </label>
            <input
              id={`${id}-price-max`}
              name="max"
              inputMode="decimal"
              defaultValue={state.max}
              placeholder="Max $"
              className="w-20 rounded border border-[#DCE5D8] bg-white px-2 py-1 text-sm"
            />
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-full bg-[#1F3A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#2c5140]"
          >
            Apply filters
          </button>
          {hasFilters(state) && (
            <Link
              href={hrefWith(base, {
                ...state,
                organic: false,
                onSale: false,
                inStock: false,
                dietary: [],
                min: undefined,
                max: undefined,
                subcategory: undefined,
              })}
              className="text-sm text-[#1F3A2E] underline"
            >
              Clear
            </Link>
          )}
        </div>
      </form>
    </div>
  )
  return (
    <aside aria-label="Filters">
      {/* Collapsed on small screens, always open on large ones */}
      <details className="rounded-xl bg-white p-4 lg:hidden">
        <summary className="cursor-pointer font-medium text-[#1F3A2E]">Filters</summary>
        <div className="mt-4">{panel('m')}</div>
      </details>
      <div className="hidden lg:block">{panel('d')}</div>
    </aside>
  )
}

function EmptyState({ base, state }: { base: string; state: ListingState }) {
  return (
    <div className="rounded-xl bg-white p-8 text-center">
      <p className="mb-2 font-medium text-[#1F3A2E]">No products match.</p>
      <p className="mb-4 text-sm text-neutral-700">
        {state.q ? 'Check the spelling or try a more general word.' : 'Try removing a filter.'}
      </p>
      <Link
        href={
          hasFilters(state)
            ? hrefWith(base, {
                ...state,
                organic: false,
                onSale: false,
                inStock: false,
                dietary: [],
                min: undefined,
                max: undefined,
                subcategory: undefined,
              })
            : '/shop'
        }
        className="text-sm text-[#1F3A2E] underline"
      >
        {hasFilters(state) ? 'Clear filters' : 'Browse all products'}
      </Link>
    </div>
  )
}

function Pagination({ base, state, pages }: { base: string; state: ListingState; pages: number }) {
  const nums = [...new Set([1, state.page - 1, state.page, state.page + 1, pages])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b)
  const link = 'rounded-full px-3 py-1.5 text-sm'
  return (
    <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center justify-center gap-1">
      {state.page > 1 && (
        <Link
          rel="prev"
          href={hrefWith(base, state, { page: state.page - 1 })}
          className={`${link} text-[#1F3A2E] hover:bg-white`}
        >
          ← Previous
        </Link>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-neutral-500">…</span>}
          <Link
            href={hrefWith(base, state, { page: n })}
            aria-current={n === state.page ? 'page' : undefined}
            className={`${link} ${n === state.page ? 'bg-[#1F3A2E] text-white' : 'text-[#1F3A2E] hover:bg-white'}`}
          >
            {n}
          </Link>
        </span>
      ))}
      {state.page < pages && (
        <Link
          rel="next"
          href={hrefWith(base, state, { page: state.page + 1 })}
          className={`${link} text-[#1F3A2E] hover:bg-white`}
        >
          Next →
        </Link>
      )}
    </nav>
  )
}
