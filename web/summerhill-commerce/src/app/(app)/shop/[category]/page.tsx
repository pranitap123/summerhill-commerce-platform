import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { parseListing, type RawParams } from '@/components/storefront/params'

import { categoryBySlug } from '../../_lib/catalog'
import { AsyncListing } from '../../_lib/AsyncListing'

type Props = { params: Promise<{ category: string }>; searchParams: Promise<RawParams> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await categoryBySlug((await params).category)
  if (!category) return { title: 'Category not found' }
  return {
    title: category.name,
    description: `${category.productCount} ${category.name.toLowerCase()} products: ${category.subcategories.map((s) => s.name).join(', ')}.`,
    alternates: { canonical: `/shop/${category.slug}` },
  }
}

/** /shop/{category}: one category, with its subcategories as a facet (G3-13, G3-14). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const category = await categoryBySlug((await params).category)
  if (!category) notFound()
  const state = parseListing(await searchParams)
  return (
    <AsyncListing
      fixed={{ category: category.slug }}
      base={`/shop/${category.slug}`}
      state={state}
      title={category.name}
      categoryLinks={false}
      intro={
        <nav aria-label="Breadcrumb" className="text-sm text-neutral-700">
          <ol className="flex gap-2">
            <li>
              <Link href="/shop" className="underline">
                Shop
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{category.name}</li>
          </ol>
        </nav>
      }
    />
  )
}
