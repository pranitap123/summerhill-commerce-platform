import Link from 'next/link'

import AddToCartButton from '@/components/AddToCartButton'
import { ProductPrice, SaleBadge } from '@/components/ProductPrice'
import { claimLabel, DIETARY_DISCLAIMER, formatDays } from '@/components/storefront/format'
import { productJsonLd, serializeJsonLd } from '@/components/storefront/jsonLd'
import type { ProductSummary } from '@/modules/catalog'
import { formatCad } from '@/utilities/money'

export function ProductDetail({ product, baseUrl }: { product: ProductSummary; baseUrl: string }) {
  const days = formatDays(product.availableDays)
  const weighed = product.pricingModel === 'per_weight'
  return (
    <article className="container py-8 md:py-12">
      <script
        type="application/ld+json"

        dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(product, baseUrl)) }}
      />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-neutral-700">
        <ol className="flex flex-wrap gap-2">
          <li>
            <Link href="/shop" className="underline">
              Shop
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          {product.categorySlug ? (
            <li>
              <Link href={`/shop/${product.categorySlug}`} className="underline">
                {product.category}
              </Link>
            </li>
          ) : (
            <li>{product.category}</li>
          )}
          <li aria-hidden="true">/</li>
          {product.categorySlug && product.subcategorySlug ? (
            <li>
              <Link
                href={`/shop/${product.categorySlug}?sub=${product.subcategorySlug}`}
                className="underline"
              >
                {product.subcategory}
              </Link>
            </li>
          ) : (
            <li>{product.subcategory}</li>
          )}
        </ol>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="self-start overflow-hidden rounded-2xl bg-[#F1ECE1]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local placeholder images until the image mirror (CATALOG §6) */}
          <img
            src={product.images[0]}
            alt={product.name}
            width={640}
            height={640}
            className="aspect-square w-full object-cover"
          />
        </div>

        <div>
          {product.brand && (
            <p className="text-sm uppercase tracking-wide text-neutral-600">{product.brand}</p>
          )}
          <h1 className="font-display mb-3 text-3xl font-semibold text-[#1F3A2E] md:text-4xl">
            {product.name}
          </h1>
          <div className="mb-3 flex flex-wrap gap-2">
            {product.onSale && <SaleBadge label={product.promoLabel} />}
            {product.organic && (
              <span className="rounded bg-[#1F3A2E] px-1.5 py-0.5 text-xs font-medium text-white">
                Organic
              </span>
            )}
          </div>
          <p className="mb-4">
            <ProductPrice product={product} size="lg" />
          </p>

          <ul className="mb-6 space-y-1 text-sm text-[#211F1C]">
            <li>
              {product.taxCode === 'HST_STANDARD' ? 'Plus 13% HST.' : 'No HST (basic grocery).'}
            </li>
            {product.depositCents > 0 && (
              <li>Plus {formatCad(product.depositCents)} container deposit.</li>
            )}
            {weighed && (
              <li>
                Weighed at the store: you pay for the actual weight. We hold a little extra on your
                card and release what isn&apos;t used.
              </li>
            )}
            {days && <li>Available for pickup {days}.</li>}
            {product.minQty > 0 && <li>Minimum {product.minQty} per order.</li>}
            {product.maxQty > 0 && <li>Maximum {product.maxQty} per order.</li>}
            <li>
              Sold by{' '}
              <Link href={`/stores/${product.merchantSlug}`} className="underline">
                {product.merchantName}
              </Link>
            </li>
          </ul>

          <AddToCartButton product={product} />

          <section aria-labelledby="about" className="mt-8">
            <h2 id="about" className="mb-2 text-lg font-semibold text-[#1F3A2E]">
              About this product
            </h2>
            <p className="text-[#211F1C]">{product.description || 'No description available.'}</p>
          </section>

          {product.dietaryClaims.length > 0 && (
            <section aria-labelledby="dietary" className="mt-6">
              <h2 id="dietary" className="mb-2 text-lg font-semibold text-[#1F3A2E]">
                Dietary information
              </h2>
              <ul className="mb-2 flex flex-wrap gap-2">
                {product.dietaryClaims.map((c) => (
                  <li
                    key={c}
                    className="rounded-full bg-[#DCE5D8] px-3 py-1 text-sm text-[#1F3A2E]"
                  >
                    {claimLabel(c)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-neutral-600">{DIETARY_DISCLAIMER}</p>
            </section>
          )}

          {(product.nutritionLabel || product.disclaimer) && (
            <section aria-labelledby="label" className="mt-6">
              <h2 id="label" className="mb-2 text-lg font-semibold text-[#1F3A2E]">
                Label information
              </h2>
              {product.nutritionLabel && (
                <p className="whitespace-pre-line text-sm">{product.nutritionLabel}</p>
              )}
              {product.disclaimer && (
                <p className="mt-2 text-xs text-neutral-600">{product.disclaimer}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </article>
  )
}
