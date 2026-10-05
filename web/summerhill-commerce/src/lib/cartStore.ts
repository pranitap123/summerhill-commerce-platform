import { create } from 'zustand'

import type { CartView } from '@/app/api/v1/_lib/cart'

type ItemPatch = {
  quantity?: number
  weightLb?: number
  replacementPreference?: 'best_match' | 'specific' | 'refund'
  replacementProductIds?: string[]
  note?: string | null
}

type AddInput = { productId: string; quantity?: number; weightLb?: number; replaceCart?: boolean }

interface CartState {
  view: CartView | null
  refresh: () => Promise<void>
  add: (input: AddInput) => Promise<{ ok: boolean; code?: string }>
  update: (lineId: number, patch: ItemPatch) => Promise<void>
  remove: (lineId: number) => Promise<void>
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  })
}

/** The server owns the cart (cookie or session); this store only mirrors its latest view. */
export const useCartStore = create<CartState>()((set) => {
  const apply = async (res: Response) => {
    if (res.ok) set({ view: (await res.json()) as CartView })
  }
  return {
    view: null,
    refresh: async () => apply(await call('/api/v1/cart')),
    add: async (input) => {
      const res = await call('/api/v1/cart/items', { method: 'POST', body: JSON.stringify(input) })
      await apply(res)
      if (res.ok) return { ok: true }
      const body = await res.json().catch(() => null)
      return { ok: false, code: body?.error?.code as string | undefined }
    },
    update: async (lineId, patch) =>
      apply(await call(`/api/v1/cart/items/${lineId}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    remove: async (lineId) => apply(await call(`/api/v1/cart/items/${lineId}`, { method: 'DELETE' })),
  }
})

/** Items shown on the header badge: each cart line counts its quantity, a weighed line counts 1. */
export function cartCount(view: CartView | null): number {
  return view?.cart?.items.reduce((n, i) => n + (i.quantity ?? 1), 0) ?? 0
}
