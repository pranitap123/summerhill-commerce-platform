'use client'

import { useState } from 'react'

import { buttonCls, inputCls, newKey, opsFetch, useOpsAction } from '../../_components/actions'

/** Approve (refund per the liability matrix) or reject with a note the customer receives. */
export function ResolveIssue({
  issueId,
  needsScenario,
}: {
  issueId: number
  needsScenario: boolean
}) {
  const { run, busy, feedback } = useOpsAction()
  const [key] = useState(newKey)
  const [note, setNote] = useState('')
  const [scenario, setScenario] = useState('goodwill')
  const [liability, setLiability] = useState('platform')
  const submit = (decision: 'approve' | 'reject') =>
    run(
      () =>
        opsFetch(
          'POST',
          `issues/${issueId}/resolve`,
          {
            decision,
            note,
            ...(decision === 'approve' && needsScenario
              ? { scenario, ...(scenario === 'goodwill' ? { liability } : {}) }
              : {}),
          },
          key,
        ),
      (r: { status: string }) => `Issue ${r.status}`,
    )
  return (
    <form className="space-y-3 text-sm" onSubmit={(e) => e.preventDefault()}>
      {needsScenario && (
        <div className="flex flex-wrap gap-3">
          <label>
            <span className="block">Case (liability matrix)</span>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className={inputCls}
            >
              <option value="goodwill">Goodwill</option>
              <option value="missing_item">Missing item (merchant)</option>
              <option value="damaged">Damaged (merchant)</option>
              <option value="wrong_substitute">Wrong item (merchant)</option>
              <option value="quality">Quality (merchant)</option>
              <option value="price_error">Price error (platform)</option>
            </select>
          </label>
          {scenario === 'goodwill' && (
            <label>
              <span className="block">Who bears it</span>
              <select
                value={liability}
                onChange={(e) => setLiability(e.target.value)}
                className={inputCls}
              >
                <option value="platform">Platform</option>
                <option value="merchant">Merchant</option>
                <option value="split">Split</option>
              </select>
            </label>
          )}
        </div>
      )}
      <label className="block">
        <span className="block">Note (the customer sees it if you reject)</span>
        <textarea
          required
          minLength={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={`${inputCls} w-full`}
          rows={3}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || note.trim().length < 3}
          className={buttonCls}
          onClick={() => submit('approve')}
        >
          Approve and refund
        </button>
        <button
          type="button"
          disabled={busy || note.trim().length < 3}
          className="rounded border border-[#B3261E] px-3 py-1.5 text-[#B3261E] disabled:opacity-50"
          onClick={() => submit('reject')}
        >
          Reject
        </button>
      </div>
      {feedback}
    </form>
  )
}
