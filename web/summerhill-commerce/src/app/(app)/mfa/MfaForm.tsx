'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

async function call(path: string, body?: unknown) {
  const res = await fetch(`/api/v1/me/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message ?? 'Something went wrong')
  return data
}

/** Enrolment (secret shown once) and code entry (G5-12). */
export function MfaForm({
  confirmed,
  next,
  email,
}: {
  confirmed: boolean
  next: string
  email: string
}) {
  const router = useRouter()
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (!confirmed && !secret)
    return (
      <div className="space-y-4">
        <p>
          Staff accounts ({email}) need a second step at sign-in. Install an authenticator app
          (1Password, Google Authenticator, Microsoft Authenticator…) and set it up here.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(async () => setSecret(await call('mfa')))}
          className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
        >
          Set up two-step verification
        </button>
        {error && (
          <p role="alert" className="text-[#B3261E]">
            {error}
          </p>
        )}
      </div>
    )

  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          await call('mfa/verify', { code })
          router.push(next)
          router.refresh()
        })
      }}
    >
      {secret && (
        <div className="rounded border bg-white p-4 text-sm">
          <p className="mb-2">
            Add this key to your authenticator app (it&apos;s shown only now), or open the link on
            the phone that has the app:
          </p>
          <p className="mb-2 font-mono text-base tracking-wider" data-testid="mfa-secret">
            {secret.secret.match(/.{1,4}/g)?.join(' ')}
          </p>
          <a href={secret.otpauthUri} className="underline">
            Open in authenticator app
          </a>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block">6-digit code from your authenticator app</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="w-40 rounded border px-3 py-2 font-mono text-lg tracking-widest"
        />
      </label>
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
      >
        Verify
      </button>
      {error && (
        <p role="alert" className="text-[#B3261E]">
          {error}
        </p>
      )}
    </form>
  )
}
