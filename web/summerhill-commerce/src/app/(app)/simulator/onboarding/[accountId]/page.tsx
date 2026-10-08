import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getSimAccount } from '@/modules/payments'
import { getConfig } from '@/server/config'

import { CompleteOnboarding } from './CompleteOnboarding'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Test onboarding', robots: { index: false } }

export default async function SimulatorOnboardingPage({
  params,
}: {
  params: Promise<{ accountId: string }>
}) {
  if (getConfig().PAYMENT_PROVIDER !== 'simulator') notFound()
  const { accountId } = await params
  const account = await getSimAccount(accountId)
  if (!account) notFound()
  return (
    <div className="container mx-auto my-12 max-w-xl">
      <p className="mb-2 inline-block rounded bg-[#FFF1D6] px-2 py-1 text-xs">
        Payment simulator: no Stripe account, nothing real is collected
      </p>
      <h1 className="mb-4 text-3xl">Set up payouts for {account.name}</h1>
      <p className="mb-6">
        On Stripe, the merchant would now enter business details, identity documents and a bank
        account, and accept the Connected Account Agreement. This simulated account is approved as
        soon as you continue.
      </p>
      {account.chargesEnabled ? (
        <p role="status">This account is already set up.</p>
      ) : (
        <CompleteOnboarding accountId={account.id} />
      )}
    </div>
  )
}
