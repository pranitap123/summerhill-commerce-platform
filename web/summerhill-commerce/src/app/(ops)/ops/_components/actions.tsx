'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

export async function opsFetch(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const details = data?.error?.details
    const extra = Array.isArray(details)
      ? `: ${details.map((d: { path: string; message: string }) => `${d.path} ${d.message}`).join('; ')}`
      : ''
    throw new Error(`${data?.error?.message ?? `Request failed (${res.status})`}${extra}`)
  }
  return data
}

export const newKey = () => `ops-${crypto.randomUUID()}`

export function useOpsAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  async function run<T>(fn: () => Promise<T>, done?: (result: T) => string | void) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await fn()
      const text = done?.(result)
      if (text) setMessage(text)
      router.refresh()
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return null
    } finally {
      setBusy(false)
    }
  }
  const feedback = (
    <>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#B3261E]">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-[#1F3A2E]">
          {message}
        </p>
      )}
    </>
  )
  return { run, busy, error, feedback }
}

export function ActionButton({
  method = 'POST',
  path,
  body,
  children,
  confirm,
  money,
  done,
  variant = 'primary',
}: {
  method?: 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  children: ReactNode
  confirm?: string
  money?: boolean
  done?: string
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const { run, busy, feedback } = useOpsAction()
  const [key] = useState(newKey)
  const styles = {
    primary: 'bg-[#1F3A2E] text-white',
    secondary: 'border border-[#1F3A2E] text-[#1F3A2E]',
    danger: 'bg-[#B3261E] text-white',
  }
  return (
    <span className="inline-block">
      <button
        type="button"
        disabled={busy}
        className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${styles[variant]}`}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          run(
            () => opsFetch(method, path, body ?? {}, money ? key : undefined),
            () => done,
          )
        }}
      >
        {children}
      </button>
      {feedback}
    </span>
  )
}

export const inputCls = 'rounded border border-neutral-400 px-2 py-1 text-sm'
export const buttonCls = 'rounded bg-[#1F3A2E] px-3 py-1.5 text-sm text-white disabled:opacity-50'
