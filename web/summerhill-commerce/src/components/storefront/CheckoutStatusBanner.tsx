'use client'

import { useEffect, useState } from 'react'

/**
 * Kill-switch banner (G5-10): when ops turn checkout off, every storefront page says so within
 * one poll (15 s). Reads /api/v1/status, which reads the flag without a cache.
 */
export const STATUS_POLL_MS = 15_000

export function CheckoutStatusBanner() {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch('/api/v1/status', { cache: 'no-store' })
        if (res.ok && !stopped) setClosed(!(await res.json()).checkoutEnabled)
      } catch {
        // offline: keep the last known state
      }
    }
    check()
    const t = setInterval(check, STATUS_POLL_MS)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [])
  if (!closed) return null
  return (
    <div role="status" className="bg-[#FFF1D6] px-4 py-2 text-center text-sm text-[#6B4A00]">
      Checkout is paused right now. You can keep browsing and filling your cart; please try again
      shortly.
    </div>
  )
}
