'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'

import { CartApiError, useCartStore } from '@/lib/cartStore'

export interface AddableProduct {
  id: string
  name: string
  availability: 'in_stock' | 'out_of_stock'
  pricingModel: 'each' | 'per_weight'
  sellBy: 'quantity' | 'weight'
  minWeightLb: string
  weightStepLb: string
}

function weightOptions(p: AddableProduct): number[] {
  const min = Number(p.minWeightLb)
  const step = Number(p.weightStepLb)
  const out: number[] = []
  for (let w = min; w <= 5 + 1e-9; w += step) out.push(Math.round(w * 1000) / 1000)
  return out
}

export default function AddToCartButton({ product }: { product: AddableProduct }) {
  const add = useCartStore((s) => s.add)
  const byWeight = product.pricingModel === 'per_weight' && product.sellBy === 'weight'
  const options = byWeight ? weightOptions(product) : []
  const [weightLb, setWeightLb] = useState<number>(options[Math.min(2, options.length - 1)] ?? 1)
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (product.availability !== 'in_stock')
    return <p className="font-medium text-neutral-600">Not available right now</p>

  async function handleClick(replaceCart = false) {
    setState('busy')
    setError(null)
    try {
      await add(product.id, byWeight ? { weightLb } : { quantity: 1 }, { replaceCart })
      setState('added')
      setTimeout(() => setState('idle'), 1500)
    } catch (err) {
      setState('idle')
      if (err instanceof CartApiError && err.code === 'CART_MIXED_MERCHANTS' && !replaceCart) {
        if (window.confirm(`${err.message}`)) await handleClick(true)
        return
      }
      setError(err instanceof Error ? err.message : 'Could not add to cart')
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {byWeight && (
        <label className="flex items-center gap-2 text-sm text-[#211F1C]">
          Weight
          <select
            value={weightLb}
            onChange={(e) => setWeightLb(Number(e.target.value))}
            className="rounded border border-neutral-300 bg-white px-2 py-1"
          >
            {options.map((w) => (
              <option key={w} value={w}>
                {w.toFixed(2)} lb
              </option>
            ))}
          </select>
        </label>
      )}
      <motion.button
        type="button"
        onClick={() => handleClick()}
        disabled={state === 'busy'}
        whileTap={{ scale: 0.96 }}
        className="relative overflow-hidden rounded-full bg-[#1F3A2E] px-8 py-3.5 font-medium text-white transition-colors hover:bg-[#16291F] disabled:opacity-70"
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {state === 'added' ? 'Added ✓' : state === 'busy' ? 'Adding…' : 'Add to Cart'}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      {error && (
        <p role="alert" className="text-sm text-[#B3261E]">
          {error}
        </p>
      )}
    </div>
  )
}
