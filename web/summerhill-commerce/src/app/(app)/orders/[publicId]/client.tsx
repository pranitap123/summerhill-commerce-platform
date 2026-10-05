'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useCartStore } from '@/lib/cartStore'

/** After returning from Stripe: the server cart was converted, so re-read it for the header. */
export function CartReset() {
  const refresh = useCartStore((s) => s.refresh)
  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])
  return null
}

/**
 * The payment webhook usually lands within seconds of the redirect. Re-render the page every 2 s
 * for up to a minute, then tell the customer it's safe to leave (the order still updates).
 */
export function WaitForPayment() {
  const router = useRouter()
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (tries >= 30) return
    const t = setTimeout(() => {
      router.refresh()
      setTries((n) => n + 1)
    }, 2000)
    return () => clearTimeout(t)
  }, [tries, router])
  return (
    <p role="status" className="mb-6">
      {tries < 30
        ? 'Confirming your payment with the bank…'
        : 'Still confirming. You can close this page; we will email you as soon as your order is placed.'}
    </p>
  )
}
