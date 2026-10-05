import { Suspense, type ComponentProps } from 'react'

import { CatalogListing } from '@/components/storefront/CatalogListing'
import { ListingSkeleton } from '@/components/storefront/ListingSkeleton'
import { toQuery } from '@/components/storefront/params'

import { loadListing } from './listing'

type Props = Omit<ComponentProps<typeof CatalogListing>, 'result'> & {
  fixed?: Parameters<typeof toQuery>[1]
}

async function Results({ fixed, ...props }: Props) {
  return <CatalogListing {...props} result={await loadListing(props.state, fixed)} />
}

/**
 * Streams a listing behind a skeleton. Pages resolve their category/store (and call notFound())
 * *before* rendering this, so unknown URLs still get a real 404 status; a route-level loading.tsx
 * would start streaming first and turn every 404/redirect into a 200.
 */
export function AsyncListing(props: Props) {
  return (
    <Suspense key={JSON.stringify(props.state)} fallback={<ListingSkeleton />}>
      <Results {...props} />
    </Suspense>
  )
}
