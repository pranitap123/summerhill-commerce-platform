'use client'

import { useEffect, useState } from 'react'

import { formatUnitPrice } from '@/utilities/money'

interface Option {
  productId: string
  name: string
  image: string | null
  effectivePriceCents: number
  unit: 'ea' | 'lb'
}

export function ReplacementChooser({
  lineId,
  selected,
  onSave,
  onCancel,
}: {
  lineId: number
  selected: string[]
  onSave(productIds: string[]): Promise<void>
  onCancel(): void
}) {
  const [options, setOptions] = useState<Option[] | null>(null)
  const [ranked, setRanked] = useState<string[]>(selected)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/v1/cart/items/${lineId}/replacements`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => live && setOptions(data.options ?? []))
      .catch(() => live && setError('Could not load replacement options'))
    return () => {
      live = false
    }
  }, [lineId])

  const toggle = (id: string) =>
    setRanked((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length < 3 ? [...r, id] : r))

  return (
    <div className="mt-2 rounded border border-neutral-300 bg-[#FAF6EE] p-3 text-sm">
      <p className="mb-2 font-medium">Choose up to 3 replacements, in order of preference</p>
      {!options && !error && <p>Loading…</p>}
      {options?.length === 0 && <p>No similar products right now.</p>}
      <ul className="space-y-1">
        {options?.map((o) => {
          const rank = ranked.indexOf(o.productId)
          return (
            <li key={o.productId}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={rank >= 0}
                  disabled={rank < 0 && ranked.length >= 3}
                  onChange={() => toggle(o.productId)}
                />
                <span className="w-5 text-center font-semibold" aria-hidden>
                  {rank >= 0 ? rank + 1 : ''}
                </span>
                <span className="flex-1">{o.name}</span>
                <span className="text-neutral-600">
                  {formatUnitPrice(o.effectivePriceCents, o.unit)}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-neutral-600">
        You never pay more than the item you ordered, and you can reject a replacement before your
        order is packed.
      </p>
      {error && (
        <p role="alert" className="text-[#B3261E]">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={ranked.length === 0 || saving}
          className="rounded bg-[#1F3A2E] px-3 py-1 text-white disabled:opacity-50"
          onClick={async () => {
            setSaving(true)
            setError(null)
            try {
              await onSave(ranked)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not save')
              setSaving(false)
            }
          }}
        >
          Save choices
        </button>
        <button type="button" className="underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
