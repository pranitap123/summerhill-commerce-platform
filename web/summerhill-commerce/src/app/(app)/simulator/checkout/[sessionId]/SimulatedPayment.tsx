'use client'

import { useState } from 'react'

import { formatCad } from '@/utilities/money'

interface View {
  id: string
  status: 'open' | 'complete' | 'expired'
  expired: boolean
  challenge: boolean
  amountCents: number
  email: string | null
  description: string | null
  lines: Array<{ name: string; quantity: number; amountCents: number }>
  submitMessage: string | null
  cancelUrl: string | null
}

const TEST_CARDS: Array<[string, string]> = [
  ['4242 4242 4242 4242', 'succeeds'],
  ['4000 0000 0000 0002', 'declined'],
  ['4000 0027 6000 3184', '3-D Secure challenge'],
]

/** The simulator's payment form (G4-18). Accepts Stripe's test card numbers only. */
export function SimulatedPayment({ view }: { view: View }) {
  const [card, setCard] = useState('')
  const [challenge, setChallenge] = useState(view.challenge)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(body: Record<string, string>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/simulator/checkout/${view.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? 'Payment failed')
      if (data.outcome === 'succeeded') {
        window.location.href = data.redirectUrl
        return
      }
      if (data.outcome === 'requires_action') setChallenge(true)
      else {
        setChallenge(false)
        setError(data.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <p className="mb-4 rounded bg-[#FFF4D6] p-3 text-sm">
        <strong>Payment simulator, test mode.</strong> No real card is charged. This page stands in
        for the payment provider in end-to-end tests and keyless demos.
      </p>
      <h1 className="mb-1 text-2xl font-semibold">Pay {formatCad(view.amountCents)}</h1>
      {view.description && <p className="text-sm text-neutral-600">{view.description}</p>}
      <ul className="my-4 divide-y divide-[#DCE5D8] text-sm">
        {view.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-1">
            <span>
              {l.name}
              {l.quantity > 1 ? ` × ${l.quantity}` : ''}
            </span>
            <span>{formatCad(l.amountCents)}</span>
          </li>
        ))}
      </ul>
      {view.status === 'complete' ? (
        <p>This payment is complete.</p>
      ) : view.expired ? (
        <p role="alert">This checkout has expired. Return to the store and try again.</p>
      ) : challenge ? (
        <section aria-label="Authentication" className="rounded-xl border-2 border-[#1F3A2E] p-4">
          <h2 className="mb-2 font-semibold">Authentication required (simulated 3-D Secure)</h2>
          <p className="mb-3 text-sm">Your bank asks you to confirm this payment.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ action: 'complete_3ds' })}
              className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
            >
              Complete authentication
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ action: 'fail_3ds' })}
              className="rounded border px-4 py-2"
            >
              Fail authentication
            </button>
          </div>
        </section>
      ) : (
        <form
          method="post"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            send({ action: 'pay', cardNumber: card })
          }}
        >
          {view.email && <p className="text-sm">Email: {view.email}</p>}
          <label className="block text-sm">
            Card number
            <input
              value={card}
              onChange={(e) => setCard(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="4242 4242 4242 4242"
              required
              className="mt-1 w-full rounded border px-3 py-2 font-mono"
            />
          </label>
          {view.submitMessage && <p className="text-sm text-neutral-700">{view.submitMessage}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#1F3A2E] px-6 py-3 text-white disabled:opacity-50"
          >
            {busy ? 'Processing…' : `Authorise ${formatCad(view.amountCents)}`}
          </button>
          <details className="text-sm">
            <summary className="cursor-pointer">Test cards</summary>
            <ul className="mt-1">
              {TEST_CARDS.map(([n, what]) => (
                <li key={n}>
                  <button type="button" className="font-mono underline" onClick={() => setCard(n)}>
                    {n}
                  </button>{' '}
                  {what}
                </li>
              ))}
            </ul>
          </details>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[#B3261E]">
          {error}
        </p>
      )}
      {view.cancelUrl && view.status === 'open' && (
        <p className="mt-6 text-sm">
          <a href={view.cancelUrl} className="underline">
            ← Back to the store
          </a>
        </p>
      )}
    </div>
  )
}
