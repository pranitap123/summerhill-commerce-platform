'use client'

import { useState } from 'react'

export function CompleteOnboarding({ accountId }: { accountId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await fetch(`/api/simulator/onboarding/${accountId}`, { method: 'POST' })
          const data = await res.json().catch(() => null)
          if (!res.ok) {
            setError(data?.error?.message ?? 'Something went wrong')
            setBusy(false)
            return
          }
          window.location.assign(data.returnUrl ?? '/ops/merchants')
        }}
      >
        Agree and submit (test)
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[#B3261E]">
          {error}
        </p>
      )}
    </div>
  )
}
