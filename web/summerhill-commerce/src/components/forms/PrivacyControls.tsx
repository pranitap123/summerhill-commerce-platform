'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Customer privacy self-service (G5-17, SECURITY §7.3): download your data as JSON, or close the
 * account (orders are kept for tax records with your contact details removed).
 */
export function PrivacyControls() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-4 text-sm">
      <p>
        {/* A file download from the API, not a page: next/link doesn't apply */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/v1/me/data" className="underline">
          Download my data (JSON)
        </a>
      </p>
      {confirming ? (
        <div className="space-y-2">
          <p>
            Close your account? You won&apos;t be able to sign in again. Past orders are kept for 7
            years for tax records, with your name and email removed.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              className="rounded bg-[#B3261E] px-3 py-1.5 text-white disabled:opacity-50"
              onClick={async () => {
                setBusy(true)
                setError(null)
                const res = await fetch('/api/v1/me/delete-account', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ confirm: 'DELETE' }),
                })
                if (res.ok) {
                  router.push('/')
                  router.refresh()
                } else {
                  const data = await res.json().catch(() => null)
                  setError(data?.error?.message ?? 'Something went wrong')
                  setBusy(false)
                }
              }}
            >
              Yes, close my account
            </button>
            <button type="button" className="underline" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="underline" onClick={() => setConfirming(true)}>
          Close my account
        </button>
      )}
      {error && (
        <p role="alert" className="text-[#B3261E]">
          {error}
        </p>
      )}
    </div>
  )
}
