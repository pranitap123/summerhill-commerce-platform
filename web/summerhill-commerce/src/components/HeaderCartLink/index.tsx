'use client'

import { ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { cartCount, useCartStore } from '@/lib/cartStore'

export function HeaderCartLink() {
  const view = useCartStore((s) => s.view)
  const refresh = useCartStore((s) => s.refresh)
  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  const count = cartCount(view)
  return (
    <Link
      href="/cart"
      className="relative flex items-center"
      aria-label={count ? `View cart, ${count} items` : 'View cart'}
    >
      <ShoppingCart className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C9962C] px-1 text-xs text-white">
          {count}
        </span>
      )}
    </Link>
  )
}
