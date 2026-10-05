'use client'

import { useState } from 'react'

import { buttonCls, inputCls, opsFetch, useOpsAction } from '../_components/actions'

/** Export (download JSON) or delete (anonymise) someone's data, by email (SECURITY §7.3). */
export function PrivacyForms() {
  const { run, busy, feedback } = useOpsAction()
  const [email, setEmail] = useState('')
  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="block">Email of the person asking</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputCls} w-80`}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !email}
          className={buttonCls}
          onClick={() =>
            run(
              () => opsFetch('POST', 'privacy/export', { email }),
              (data: unknown) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = 'personal-data.json'
                a.click()
                URL.revokeObjectURL(a.href)
                return 'Export downloaded'
              },
            )
          }
        >
          Export data (JSON)
        </button>
        <button
          type="button"
          disabled={busy || !email}
          className="rounded bg-[#B3261E] px-3 py-1.5 text-white disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                `Delete ${email}'s account and anonymise their orders? This can't be undone.`,
              )
            )
              return
            run(
              () => opsFetch('POST', 'privacy/delete', { email, confirm: 'DELETE' }),
              (r: { ordersAnonymised: number; accountClosed: boolean }) =>
                `Done: ${r.ordersAnonymised} order(s) anonymised${r.accountClosed ? ', account closed' : ''}`,
            )
          }}
        >
          Delete (anonymise)
        </button>
      </div>
      {feedback}
    </div>
  )
}
