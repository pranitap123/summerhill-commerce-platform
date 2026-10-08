'use client'

import { create } from 'zustand'

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

export const cartCount = (view: CartView | null) => view?.cart?.items.length ?? 0
