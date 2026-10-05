'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('The passwords do not match.')
    setState('busy')
    setError(null)
    const res = await fetch('/api/users/reset-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    if (res?.ok) return setState('done')
    const body = await res?.json().catch(() => null)
    setError(body?.errors?.[0]?.message ?? 'This link is invalid or has expired.')
    setState('idle')
  }

  if (!token) return <p>This link is incomplete. Request a new one from the login page.</p>
  if (state === 'done')
    return (
      <p role="status">
        Your password was changed. <Link href="/account">Go to your account</Link>.
      </p>
    )
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="confirm">Repeat the new password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[#B3261E]">
          {error}
        </p>
      )}
      <Button type="submit" disabled={state === 'busy'} className="self-start">
        {state === 'busy' ? 'Saving…' : 'Save new password'}
      </Button>
    </form>
  )
}
