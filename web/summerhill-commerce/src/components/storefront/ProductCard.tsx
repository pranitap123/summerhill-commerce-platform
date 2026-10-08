import Link from 'next/link'

import { ProductPrice, SaleBadge } from '@/components/ProductPrice'
import type { ProductSummary } from '@/modules/catalog'

import { SearchResultLink } from './SearchResultLink'

export function ProductCard({
  product,
  searchId,
  position,
  priority = false,
}: {
  product: ProductSummary
  searchId?: string | null
  position?: number
  priority?: boolean
}) {
  const href = `/products/${product.slug}`
  const body = (
    <>
      <div className="relative mb-3 aspect-square overflow-hidden rounded-xl bg-[#F1ECE1]">
        {/* eslint-disable-next-line @next/next/no-img-element -- local placeholder images until the image mirror (CATALOG §6) */}
        <img
          src={product.images[0]}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          width={320}
          height={320}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {product.onSale && <SaleBadge label={product.promoLabel} />}
          {product.organic && (
            <span className="rounded bg-[#1F3A2E] px-1.5 py-0.5 text-xs font-medium text-white">
              Organic
            </span>
          )}
        </div>
      </div>
      {product.brand && (
        <p className="text-xs uppercase tracking-wide text-neutral-600">{product.brand}</p>
      )}
      <h3 className="mb-1 line-clamp-2 text-sm font-medium text-[#211F1C] group-hover:underline">
        {product.name}
      </h3>
      <ProductPrice product={product} size="sm" />
      {product.availability !== 'in_stock' && (
        <p className="mt-1 text-xs font-medium text-neutral-600">Not available right now</p>
      )}
    </>
  )
  const className =
    'group block h-full rounded-2xl bg-white p-3 shadow-sm transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9962C]'
  return (
    <li className="list-none">
      {searchId && position ? (
        <SearchResultLink
          href={href}
          className={className}
          searchId={searchId}
          productId={product.id}
          position={position}
        >
          {body}
        </SearchResultLink>
      ) : (
        <Link href={href} className={className}>
          {body}
        </Link>
      )}
    </li>
  )
}

export function ProductGrid({
  products,
  searchId,
  offset = 0,
  label,
}: {
  products: ProductSummary[]
  searchId?: string | null
  offset?: number
  label: string
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((p, i) => (
        <ProductCard
          key={p.id}
          product={p}
          searchId={searchId}
          position={offset + i + 1}
          priority={i < 4}
        />
      ))}
    </ul>
  )
}
