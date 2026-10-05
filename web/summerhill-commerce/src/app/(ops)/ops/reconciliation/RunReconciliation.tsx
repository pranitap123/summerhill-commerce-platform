'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { buttonCls, inputCls, opsFetch, useOpsAction } from '../_components/actions'

export function RunReconciliation() {
  const router = useRouter()
  const { run, busy, feedback } = useOpsAction()
  const [day, setDay] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => opsFetch('POST', 'reconciliation', { runDate: day }),
          (r: { id: number }) => {
            router.push(`/ops/reconciliation/${r.id}`)
          },
        )
      }}
    >
      <label>
        <span className="block">Business day</span>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className={inputCls}
        />
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        Reconcile
      </button>
      {feedback}
    </form>
  )
}
