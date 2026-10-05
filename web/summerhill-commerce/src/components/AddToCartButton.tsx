'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'

import { useCartStore } from '@/lib/cartStore'

type Product = { id: string; pricingModel?: 'each' | 'per_weight' | null }

export default function AddToCartButton({ product }: { product: Product }) {
  const add = useCartStore((s) => s.add)
  const [state, setState] = useState<'idle' | 'busy' | 'added' | 'mixed' | 'error'>('idle')

  async function submit(replaceCart: boolean) {
    setState('busy')
    const weighed = product.pricingModel === 'per_weight'
    const result = await add({
      productId: product.id,
      ...(weighed ? { weightLb: 1 } : { quantity: 1 }),
      ...(replaceCart ? { replaceCart } : {}),
    })
    if (result.ok) {
      setState('added')
      setTimeout(() => setState('idle'), 1500)
    } else {
      setState(result.code === 'CART_MERCHANT_MISMATCH' ? 'mixed' : 'error')
    }
  }

  if (state === 'mixed')
    return (
      <div role="alert" className="max-w-sm space-y-2 text-sm">
        <p>Your cart has items from another store. Start a new cart with this item?</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => submit(true)}
            className="rounded-full bg-[#1F3A2E] px-4 py-2 text-white"
          >
            Start new cart
          </button>
          <button type="button" onClick={() => setState('idle')} className="rounded-full border px-4 py-2">
            Keep current cart
          </button>
        </div>
      </div>
    )

  return (
    <div>
      <motion.button
        type="button"
        onClick={() => submit(false)}
        disabled={state === 'busy'}
        whileTap={{ scale: 0.96 }}
        className="relative overflow-hidden rounded-full bg-[#1F3A2E] px-8 py-3.5 font-medium text-white transition-colors hover:bg-[#16291F] disabled:opacity-60"
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={state === 'added' ? 'added' : 'add'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {state === 'added' ? 'Added ✓' : 'Add to cart'}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          Couldn&apos;t add that item. Please try again.
        </p>
      )}
    </div>
  )
}
