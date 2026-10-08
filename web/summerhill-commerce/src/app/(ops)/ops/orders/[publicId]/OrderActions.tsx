'use client'

import { useState } from 'react'

import { buttonCls, inputCls, newKey, opsFetch, useOpsAction } from '../../_components/actions'

const SCENARIOS = [
  ['missing_item', 'Item missing from the bag (merchant)'],
  ['wrong_substitute', 'Wrong or unacceptable substitute (merchant)'],
  ['damaged', 'Damaged or spoiled (merchant)'],
  ['quality', 'Quality problem (merchant)'],
  ['price_error', 'Price shown wrong: our bug (platform)'],
  ['goodwill', 'Goodwill (choose who bears it)'],
] as const

const cad = (cents: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

export function RefundForm({
  orderId,
  lines,
  remainingCents,
  limitCents,
}: {
  orderId: number
  lines: Array<{
    lineId: number
    name: string
    paidCents: number
    remainingCents: number
    quantity: number | null
    weighed: boolean
  }>
  remainingCents: number
  limitCents: number | null
}) {
  const { run, busy, feedback } = useOpsAction()
  const [key, setKey] = useState(newKey)
  const [scenario, setScenario] = useState<string>('missing_item')
  const [mode, setMode] = useState<'lines' | 'amount'>('lines')
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [amount, setAmount] = useState('')
  const [liability, setLiability] = useState('split')
  const [share, setShare] = useState('')
  const [reason, setReason] = useState('')
  const chosen = scenario === 'goodwill'
  const body = () => ({
    scenario,
    reason,
    ...(mode === 'lines'
      ? {
          lines: Object.entries(picked).map(([lineId, qty]) => ({
            lineId: Number(lineId),
            ...(qty ? { quantity: Number(qty) } : {}),
          })),
        }
      : { amountCents: Math.round(Number(amount) * 100) }),
    ...(chosen
      ? {
          liability,
          ...(liability === 'split' && share
            ? { merchantShareCents: Math.round(Number(share) * 100) }
            : {}),
        }
      : {}),
  })
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => opsFetch('POST', `orders/${orderId}/refunds`, body(), key),
          (r: { amountCents: number; status: string }) => {
            setKey(newKey())
            setPicked({})
            return `Refund of ${cad(r.amountCents)}: ${r.status}`
          },
        )
      }}
    >
      <p>
        Refundable: {cad(remainingCents)}
        {limitCents !== null && ` · your limit is ${cad(limitCents)} per order`}
      </p>
      <label className="block">
        <span className="block">Case (liability matrix)</span>
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} className={inputCls}>
          {SCENARIOS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex gap-4">
        <legend className="sr-only">Refund by</legend>
        <label>
          <input type="radio" checked={mode === 'lines'} onChange={() => setMode('lines')} /> Items
        </label>
        <label>
          <input type="radio" checked={mode === 'amount'} onChange={() => setMode('amount')} /> An
          amount
        </label>
      </fieldset>
      {mode === 'lines' ? (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.lineId} className="flex flex-wrap items-center gap-2">
              <input
                id={`refund-line-${l.lineId}`}
                type="checkbox"
                disabled={l.remainingCents === 0}
                checked={l.lineId in picked}
                onChange={() =>
                  setPicked((p) => {
                    const n = { ...p }
                    if (l.lineId in n) delete n[l.lineId]
                    else n[l.lineId] = ''
                    return n
                  })
                }
              />
              <label htmlFor={`refund-line-${l.lineId}`}>
                {l.name} ({cad(l.paidCents)}
                {l.remainingCents < l.paidCents && `, ${cad(l.remainingCents)} left`})
              </label>
              {l.lineId in picked && !l.weighed && (l.quantity ?? 1) > 1 && (
                <input
                  aria-label={`Quantity of ${l.name}`}
                  type="number"
                  min={1}
                  max={l.quantity ?? 1}
                  placeholder="all"
                  value={picked[l.lineId]}
                  onChange={(e) => setPicked((p) => ({ ...p, [l.lineId]: e.target.value }))}
                  className={`${inputCls} w-20`}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <label className="block">
          <span className="block">Amount (CAD)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
            placeholder="0.00"
          />
        </label>
      )}
      {chosen && (
        <div className="flex flex-wrap gap-3">
          <label>
            <span className="block">Who bears it</span>
            <select
              value={liability}
              onChange={(e) => setLiability(e.target.value)}
              className={inputCls}
            >
              <option value="split">Split</option>
              <option value="merchant">Merchant</option>
              <option value="platform">Platform</option>
            </select>
          </label>
          {liability === 'split' && (
            <label>
              <span className="block">Merchant share (CAD, default half)</span>
              <input
                value={share}
                onChange={(e) => setShare(e.target.value)}
                className={inputCls}
              />
            </label>
          )}
        </div>
      )}
      <label className="block">
        <span className="block">Reason (kept in the audit log)</span>
        <input
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${inputCls} w-full`}
        />
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        Refund
      </button>
      {feedback}
    </form>
  )
}

export function CancelForm({ orderId, charged }: { orderId: number; charged: boolean }) {
  const { run, busy, feedback } = useOpsAction()
  const [reason, setReason] = useState('')
  const [liability, setLiability] = useState('merchant')
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (
          !window.confirm(
            charged
              ? 'Refund in full and cancel this order?'
              : 'Cancel this order and release the card hold?',
          )
        )
          return
        run(
          () =>
            opsFetch('POST', `orders/${orderId}/cancel`, {
              reason,
              ...(charged ? { liability } : {}),
            }),
          () => 'Cancelled',
        )
      }}
    >
      <label>
        <span className="block">Reason</span>
        <input
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputCls}
        />
      </label>
      {charged && (
        <label>
          <span className="block">Who bears the refund</span>
          <select
            value={liability}
            onChange={(e) => setLiability(e.target.value)}
            className={inputCls}
          >
            <option value="merchant">Merchant</option>
            <option value="platform">Platform</option>
          </select>
        </label>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-[#B3261E] px-3 py-1.5 text-white disabled:opacity-50"
      >
        {charged ? 'Refund and cancel' : 'Cancel order'}
      </button>
      {feedback}
    </form>
  )
}
