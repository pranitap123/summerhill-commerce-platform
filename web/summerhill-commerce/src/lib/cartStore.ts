'use client'

import { create } from 'zustand'

/**
 * Client mirror of the SERVER cart (G2-06, SYSTEM_DESIGN §8). The server owns the cart and every
 * number in it; this store only caches the last response of /api/v1/cart* so components can
 * render it. Nothing is kept in localStorage any more: the cart survives reloads and devices
 * because it lives in Postgres (anonymous carts via an httpOnly cookie).
 */
export type ReplacementPreference = 'best_match' | 'specific' | 'refund'

export interface QuoteLine {
  productId: string
  lineTotalCents: number
  taxCents: number
  depositCents: number
  estimatedWeightMlb: number | null
  isWeighed: boolean
  quantity: number | null
}

export interface CartItemView {
  id: number
  productId: string
  name: string
  image: string | null
  pricingModel: 'each' | 'per_weight' | null
  sellBy: 'quantity' | 'weight' | null
  unit: 'ea' | 'lb' | null
  quantity: number | null
  weightLb: number | null
  unitPriceCents: number | null
  effectivePriceCents: number | null
  promoLabel: string | null
  replacementPreference: ReplacementPreference
  /** Ranked specific replacements (G4-04), when the preference is 'specific'. */
  replacementProductIds: string[]
  note: string | null
  available: boolean
  line: QuoteLine | null
}

export interface QuoteIssue {
  productId: string | null
  code: string
  message: string
}

export interface Quote {
  lines: QuoteLine[]
  itemSubtotalCents: number
  depositCents: number
  taxCents: number
  estimatedTotalCents: number
  weighedEstimateCents: number
  weightBufferBp: number
  weightBufferCents: number
  authorizationCents: number
  minimumOrderCents: number
  meetsMinimum: boolean
  issues: QuoteIssue[]
  canCheckout: boolean
  hash: string
}

export interface CartView {
  cart: { id: string; merchantId: number | null; items: CartItemView[] } | null
  quote: Quote | null
}

export class CartApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

async function call(method: string, url: string, body?: unknown): Promise<CartView> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok)
    throw new CartApiError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? 'Something went wrong. Please try again.',
      data?.error?.details,
    )
  return data as CartView
}

interface CartState {
  view: CartView | null
  loading: boolean
  refresh(): Promise<void>
  add(
    productId: string,
    amount: { quantity?: number; weightLb?: number },
    opts?: { replaceCart?: boolean },
  ): Promise<void>
  update(
    lineId: number,
    patch: {
      quantity?: number
      weightLb?: number
      replacementPreference?: ReplacementPreference
      replacementProductIds?: string[]
      note?: string | null
    },
  ): Promise<void>
  remove(lineId: number): Promise<void>
  /** Called after checkout redirects and on the order page, when the server cart was converted. */
  reset(): void
}

export const useCartStore = create<CartState>()((set) => ({
  view: null,
  loading: false,
  async refresh() {
    set({ loading: true })
    try {
      set({ view: await call('GET', '/api/v1/cart') })
    } finally {
      set({ loading: false })
    }
  },
  async add(productId, amount, opts = {}) {
    set({ view: await call('POST', '/api/v1/cart/items', { productId, ...amount, ...opts }) })
  },
  async update(lineId, patch) {
    set({ view: await call('PATCH', `/api/v1/cart/items/${lineId}`, patch) })
  },
  async remove(lineId) {
    set({ view: await call('DELETE', `/api/v1/cart/items/${lineId}`) })
  },
  reset() {
    set({ view: null })
  },
}))

/** Number of lines in the cart (for the header badge). */
export const cartCount = (view: CartView | null) => view?.cart?.items.length ?? 0
