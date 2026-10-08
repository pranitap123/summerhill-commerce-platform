'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useCartStore } from '@/lib/cartStore'

export function CartReset() {
  const refresh = useCartStore((s) => s.refresh)
  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])
  return null
}

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
