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

export function AsyncListing(props: Props) {
  return (
    <Suspense key={JSON.stringify(props.state)} fallback={<ListingSkeleton />}>
      <Results {...props} />
    </Suspense>
  )
}
