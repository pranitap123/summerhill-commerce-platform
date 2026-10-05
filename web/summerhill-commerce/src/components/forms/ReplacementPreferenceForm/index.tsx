'use client'

import { useState } from 'react'

type Preference = 'best_match' | 'refund'

/** Saves the customer's default replacement preference through Payload's own REST API (self only). */
export function ReplacementPreferenceForm({
  userId,
  initial,
}: {
  userId: string
  initial: Preference
}) {
  const [value, setValue] = useState<Preference>(initial)
  const [status, setStatus] = useState<string | null>(null)

  async function save(next: Preference) {
    setValue(next)
    setStatus('Saving…')
    const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultReplacementPreference: next }),
    }).catch(() => null)
    setStatus(
      res?.ok ? 'Saved. New cart items will use this.' : 'Could not save. Please try again.',
    )
  }

  return (
    <fieldset>
      <legend className="mb-3">By default, when the store is out of an item:</legend>
      {(
        [
          ['best_match', 'Replace it with the best match'],
          ['refund', "Don't replace it; I'll get a refund for that item"],
        ] as const
      ).map(([v, label]) => (
        <label key={v} className="mb-2 flex items-center gap-2">
          <input
            type="radio"
            name="replacement"
            value={v}
            checked={value === v}
            onChange={() => save(v)}
          />
          {label}
        </label>
      ))}
      <p role="status" className="mt-2 text-sm text-neutral-600">
        {status}
      </p>
    </fieldset>
  )
}
