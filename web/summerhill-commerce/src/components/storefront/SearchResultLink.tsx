'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * A search result link that reports the click (search id, product, position) for analytics
 * (G3-15). sendBeacon survives the navigation; nothing personal is sent.
 */
export function SearchResultLink({
  href,
  className,
  searchId,
  productId,
  position,
  children,
}: {
  href: string
  className: string
  searchId: string
  productId: string
  position: number
  children: ReactNode
}) {
  function report() {
    const body = JSON.stringify({ searchId, productId, position })
    try {
      if (
        !navigator.sendBeacon?.(
          '/api/v1/search/clicks',
          new Blob([body], { type: 'application/json' }),
        )
      )
        void fetch('/api/v1/search/clicks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        })
    } catch {
      // analytics must never block navigation
    }
  }
  return (
    <Link href={href} className={className} onClick={report}>
      {children}
    </Link>
  )
}
