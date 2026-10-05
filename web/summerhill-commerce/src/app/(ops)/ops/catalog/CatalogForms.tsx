'use client'

import { useState } from 'react'

import { buttonCls, inputCls, opsFetch, useOpsAction } from '../_components/actions'

export function RequestRun({ merchants }: { merchants: Array<{ id: number; name: string }> }) {
  const { run, busy, feedback } = useOpsAction()
  const [merchantId, setMerchantId] = useState(merchants[0]?.id ?? 0)
  const [mode, setMode] = useState<'full' | 'delta'>('full')
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => opsFetch('POST', 'catalog/ingest-runs', { merchantId, mode }),
          (r: { requestId: number }) => `Request #${r.requestId} queued for the pipeline`,
        )
      }}
    >
      <label>
        <span className="block">Merchant</span>
        <select
          value={merchantId}
          onChange={(e) => setMerchantId(Number(e.target.value))}
          className={inputCls}
        >
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="block">Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'full' | 'delta')}
          className={inputCls}
        >
          <option value="full">full</option>
          <option value="delta">delta</option>
        </select>
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        Run ingest
      </button>
      {feedback}
    </form>
  )
}

export function MappingSelect({
  mappingId,
  current,
  subcategories,
}: {
  mappingId: number
  current: number | null
  subcategories: Array<{ id: number; name: string; category: string }>
}) {
  const { run, busy, feedback } = useOpsAction()
  const [value, setValue] = useState(current ?? 0)
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Our subcategory"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className={inputCls}
      >
        <option value={0}>Choose…</option>
        {subcategories.map((s) => (
          <option key={s.id} value={s.id}>
            {s.category} › {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !value || value === current}
        className={buttonCls}
        onClick={() =>
          run(
            () => opsFetch('PUT', `catalog/mappings/${mappingId}`, { subcategoryId: value }),
            () => 'Mapped; a full re-run was requested',
          )
        }
      >
        Save
      </button>
      {feedback}
    </span>
  )
}

/** Hide, hide until, rename, recategorise one product (A4, overrides survive re-ingest). */
export function OverrideForm({
  productId,
  hidden,
  subcategoryId,
  subcategories,
}: {
  productId: string
  hidden: boolean
  subcategoryId: number | null
  subcategories: Array<{ id: number; name: string; category: string }>
}) {
  const { run, busy, feedback } = useOpsAction()
  const [until, setUntil] = useState('')
  const [name, setName] = useState('')
  const [sub, setSub] = useState(subcategoryId ?? 0)
  const put = (patch: Record<string, unknown>, msg: string) =>
    run(
      () => opsFetch('PUT', `products/${encodeURIComponent(productId)}/override`, patch),
      () => msg,
    )
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={buttonCls}
          onClick={() => put({ hidden: !hidden }, hidden ? 'Shown' : 'Hidden')}
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
        <label className="flex items-center gap-1">
          hide until
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="button"
          disabled={busy || !until}
          className={buttonCls}
          onClick={() => put({ hiddenUntil: new Date(until).toISOString() }, 'Hidden until then')}
        >
          Set
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          placeholder="New display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
        <button
          type="button"
          disabled={busy || name.trim().length < 1}
          className={buttonCls}
          onClick={() => put({ name: name.trim() }, 'Renamed')}
        >
          Rename
        </button>
        <select
          aria-label="Recategorise"
          value={sub}
          onChange={(e) => setSub(Number(e.target.value))}
          className={inputCls}
        >
          <option value={0}>Recategorise…</option>
          {subcategories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.category} › {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !sub || sub === subcategoryId}
          className={buttonCls}
          onClick={() => put({ subcategoryId: sub }, 'Recategorised')}
        >
          Move
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border px-3 py-1.5"
          onClick={() =>
            run(
              () => opsFetch('DELETE', `products/${encodeURIComponent(productId)}/override`),
              () => 'Override removed',
            )
          }
        >
          Remove override
        </button>
      </div>
      {feedback}
    </div>
  )
}
