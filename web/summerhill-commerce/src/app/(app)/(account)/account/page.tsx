import type { Metadata } from 'next'
import { headers as getHeaders } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AccountForm } from '@/components/forms/AccountForm'
import { PrivacyControls } from '@/components/forms/PrivacyControls'
import { ReplacementPreferenceForm } from '@/components/forms/ReplacementPreferenceForm'
import { Button } from '@/components/ui/button'
import { getSessionUser } from '@/modules/identity'
import { listOrdersForUser, STATUS_LABELS } from '@/modules/ordering'
import { formatCad } from '@/utilities/money'
import { mergeOpenGraph } from '@/utilities/mergeOpenGraph'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const user = await getSessionUser(await getHeaders())
  if (!user)
    redirect(`/login?warning=${encodeURIComponent('Please log in to access your account.')}`)
  const orders = (await listOrdersForUser(String(user.id), 5)).slice(0, 5)

  return (
    <>
      <div className="rounded-lg border bg-primary-foreground p-8">
        <h1 className="mb-8 text-3xl font-medium">Account settings</h1>
        <AccountForm />
      </div>

      <div className="rounded-lg border bg-primary-foreground p-8">
        <h2 className="mb-4 text-2xl font-medium">If an item is unavailable</h2>
        <ReplacementPreferenceForm
          userId={String(user.id)}
          initial={user.defaultReplacementPreference ?? 'best_match'}
        />
      </div>

      <div className="rounded-lg border bg-primary-foreground p-8">
        <h2 className="mb-4 text-2xl font-medium">Recent orders</h2>
        {orders.length === 0 ? (
          <p className="mb-8">You have no orders yet.</p>
        ) : (
          <ul className="mb-8 divide-y">
            {orders.map((o) => (
              <li key={o.publicId} className="flex justify-between py-2">
                <Link href={`/orders/${o.publicId}`}>{o.publicId}</Link>
                <span className="text-sm">
                  {STATUS_LABELS[o.status]} ·{' '}
                  {formatCad(o.finalTotalCents ?? o.estimatedTotalCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button asChild variant="default">
          <Link href="/orders">View all orders</Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-primary-foreground p-8">
        <h2 className="mb-4 text-2xl font-medium">Your data</h2>
        <PrivacyControls />
      </div>
    </>
  )
}

export const metadata: Metadata = {
  description: 'Your account.',
  openGraph: mergeOpenGraph({ title: 'Account', url: '/account' }),
  title: 'Account',
}
