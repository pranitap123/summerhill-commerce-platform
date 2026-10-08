'use client'

import { useEffect, useState } from 'react'

import { consoleApi, money } from '../../_lib/api'
import type { Line } from './types'

const REASONS: Array<[string, string]> = [
  ['out_of_stock', 'Out of stock'],
  ['damaged', 'Damaged'],
  ['quality', 'Poor quality'],
  ['other', 'Other'],
]

const PREFERENCE: Record<Line['replacementPreference'], string> = {
  best_match: 'Replace with best match',
  specific: 'Specific replacements only',
  refund: "Don't replace (refund)",
}

export type PickBody =
  | { action: 'picked'; quantity?: number; weightLb?: number; scannedCode?: string }
  | { action: 'unavailable'; reason: string }
  | { action: 'reset' }

export interface SubBody {
  productId: string
  quantity?: number
  weightLb?: number
  scannedCode?: string
  reason?: string
}

function amount(l: Line): string {
  if (l.sellBy === 'weight') return `${l.estimatedWeightLb?.toFixed(2)} lb (est.)`
  return `× ${l.quantity}${l.isWeighed && l.estimatedWeightLb ? ` · est. ${l.estimatedWeightLb.toFixed(2)} lb` : ''}`
}

export function LineCard({
  publicId,
  line,
  editable,
  pendingScan,
  busy,
  onPick,
  onSubstitute,
}: {
  publicId: string
  line: Line
  editable: boolean

  pendingScan: string | null
  busy: boolean
  onPick(body: PickBody): void
  onSubstitute(body: SubBody): void
}) {
  const [qty, setQty] = useState(line.quantity ?? 1)
  const [weight, setWeight] = useState('')
  const [replacing, setReplacing] = useState(false)
  const open = line.status === 'ordered'
  const resolvedClass =
    line.status === 'picked'
      ? 'border-l-8 border-[#2E7D32]'
      : line.status === 'ordered'
        ? 'border-l-8 border-neutral-300'
        : 'border-l-8 border-[#C9962C]'

  return (
    <article
      className={`rounded-xl bg-white p-3 shadow-sm ${resolvedClass}`}
      aria-label={line.name}
    >
      <div className="flex gap-3">
        {line.image && (
          // eslint-disable-next-line @next/next/no-img-element -- placeholder images (G3)
          <img src={line.image} alt="" className="h-14 w-14 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{line.name}</p>
          <p className="text-sm">
            {amount(line)} · {money(line.unitPriceCents)}
            {line.unit === 'lb' ? '/lb' : ''}
            {line.cold && ' · ❄ cold'}
            {line.upc && (
              <span className="ml-2 font-mono text-xs text-neutral-500">{line.upc}</span>
            )}
          </p>
          {line.note && <p className="text-sm font-medium text-[#8A5A00]">Note: {line.note}</p>}
          <p className="text-xs text-neutral-600">
            {PREFERENCE[line.replacementPreference]}
            {line.replacementPreference === 'specific' &&
              `: ${line.replacementProducts.map((p, i) => `${i + 1}. ${p.name}`).join(', ')}`}
          </p>
        </div>
      </div>

      {!open && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {line.status === 'picked' &&
              `✓ Picked${line.pickedQuantity ? ` ${line.pickedQuantity}` : ''}${
                line.actualWeightLb ? ` · ${line.actualWeightLb.toFixed(3)} lb` : ''
              }${line.labelPriceCents !== null ? ` · label ${money(line.labelPriceCents)}` : ''}${
                line.scannedCode ? ' · scanned' : ''
              }`}
            {line.status === 'unavailable' && `✗ Unavailable (${line.unavailableReason ?? '–'})`}
            {line.status === 'substituted' && line.substitute && (
              <>
                ⇄ Replaced with <strong>{line.substitute.name}</strong>
                {line.substitute.actualWeightLb
                  ? ` · ${line.substitute.actualWeightLb.toFixed(3)} lb`
                  : ` × ${line.substitute.pickedQuantity ?? line.substitute.quantity}`}{' '}
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    line.substitute.customerDecision === 'rejected'
                      ? 'bg-[#B3261E] text-white'
                      : line.substitute.customerDecision === 'approved'
                        ? 'bg-[#EEF3EC]'
                        : 'bg-[#FFF4D6]'
                  }`}
                >
                  customer: {line.substitute.customerDecision ?? 'pending'}
                </span>
              </>
            )}
          </span>
          {editable && (
            <button
              type="button"
              disabled={busy}
              className="rounded border px-3 py-1"
              onClick={() => onPick({ action: 'reset' })}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {open && editable && (
        <div className="mt-3 space-y-2">
          {pendingScan && (
            <p className="rounded bg-[#EEF3EC] px-2 py-1 text-sm">
              Scanned ✓ Now enter the weight from the scale.
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onPick({
                action: 'picked',
                ...(line.sellBy === 'weight' ? {} : { quantity: qty }),
                ...(line.isWeighed && weight ? { weightLb: Number(weight) } : {}),
                ...(pendingScan ? { scannedCode: pendingScan } : {}),
              })
            }}
          >
            {line.sellBy !== 'weight' && (
              <label className="text-sm">
                Qty
                <select
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="ml-1 rounded border bg-white px-2 py-2"
                >
                  {Array.from({ length: line.quantity ?? 1 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {line.isWeighed && (
              <label className="text-sm">
                Weight (lb)
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="50"
                  required
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="ml-1 w-28 rounded border px-2 py-2"
                />
              </label>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[#2E7D32] px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              ✓ Picked
            </button>
            <select
              aria-label="Mark unavailable"
              disabled={busy}
              value=""
              onChange={(e) =>
                e.target.value && onPick({ action: 'unavailable', reason: e.target.value })
              }
              className="rounded border bg-white px-2 py-2 text-sm"
            >
              <option value="">✗ Unavailable…</option>
              {REASONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || line.replacementPreference === 'refund'}
              title={
                line.replacementPreference === 'refund'
                  ? 'The customer asked for a refund'
                  : undefined
              }
              onClick={() => setReplacing((r) => !r)}
              className="rounded border border-[#1F3A2E] px-3 py-2 text-sm disabled:opacity-40"
            >
              ⇄ Replace
            </button>
          </form>
          {replacing && (
            <SubstitutePanel
              publicId={publicId}
              line={line}
              busy={busy}
              onCancel={() => setReplacing(false)}
              onSubmit={(body) => {
                setReplacing(false)
                onSubstitute(body)
              }}
            />
          )}
        </div>
      )}
    </article>
  )
}

interface Option {
  productId: string
  name: string
  upc: string | null
  unit: 'ea' | 'lb'
  sellBy: 'quantity' | 'weight'
  effectivePriceCents: number
  taxable: boolean
}

export function SubstitutePanel({
  publicId,
  line,
  busy,
  preset,
  onSubmit,
  onCancel,
}: {
  publicId: string
  line: Line
  busy: boolean
  preset?: { productId: string; scannedCode: string }
  onSubmit(body: SubBody): void
  onCancel(): void
}) {
  const [options, setOptions] = useState<Option[] | null>(null)
  const [choice, setChoice] = useState<string | null>(preset?.productId ?? null)
  const [qty, setQty] = useState(line.quantity ?? 1)
  const [weight, setWeight] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    consoleApi<{ options: Option[] }>('GET', `orders/${publicId}/lines/${line.id}/replacements`)
      .then((d) => live && setOptions(d.options))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [publicId, line.id])
  const selected = options?.find((o) => o.productId === choice)
  return (
    <div
      role="group"
      aria-label={`Replace ${line.name}`}
      className="rounded-lg border border-neutral-300 bg-[#FAF6EE] p-3 text-sm"
    >
      <p className="mb-2 font-medium">
        Replace {line.name}{' '}
        <span className="font-normal text-neutral-600">
          (the customer never pays more than {money(line.lineTotalCents)})
        </span>
      </p>
      {!options && !error && <p>Loading options…</p>}
      {options?.length === 0 && <p>No suitable replacements in stock. Mark it unavailable.</p>}
      <ul className="space-y-1">
        {options?.map((o, i) => (
          <li key={o.productId}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`sub-${line.id}`}
                checked={choice === o.productId}
                onChange={() => setChoice(o.productId)}
              />
              {line.replacementPreference === 'specific' && <strong>{i + 1}.</strong>}
              <span className="flex-1">{o.name}</span>
              <span>
                {money(o.effectivePriceCents)}
                {o.unit === 'lb' ? '/lb' : ''}
                {o.taxable ? ' + HST' : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {selected && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit({
              productId: selected.productId,
              ...(selected.sellBy === 'weight' ? {} : { quantity: qty }),
              ...(selected.unit === 'lb' && weight ? { weightLb: Number(weight) } : {}),
              ...(preset?.productId === selected.productId
                ? { scannedCode: preset.scannedCode }
                : {}),
              reason: 'Unavailable',
            })
          }}
        >
          {selected.sellBy !== 'weight' && (
            <label>
              Qty{' '}
              <input
                type="number"
                min={1}
                max={99}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-16 rounded border px-2 py-1"
              />
            </label>
          )}
          {selected.unit === 'lb' && (
            <label>
              Weight (lb){' '}
              <input
                type="number"
                step="0.001"
                min="0.001"
                max="50"
                required
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-24 rounded border px-2 py-1"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-[#1F3A2E] px-3 py-1 text-white disabled:opacity-50"
          >
            Use this replacement
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[#B3261E]">
          {error}
        </p>
      )}
      <button type="button" className="mt-2 underline" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
