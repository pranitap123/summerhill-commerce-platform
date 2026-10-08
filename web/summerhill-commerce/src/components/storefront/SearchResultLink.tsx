'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

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

    }
  }
  return (
    <Link href={href} className={className} onClick={report}>
      {children}
    </Link>
  )
}
