import { z } from 'zod'

import {
  deriveOnboardingStatus,
  getMerchantById,
  stripeTestFixtures,
  updateMerchantStatus,
} from '@/modules/merchant'
import { getStripe } from '@/modules/payments'
import {
  assertDemoToolsEnabled,
  HttpError,
  idParam,
  parseJson,
  parseParams,
  route,
} from '@/server/http'

const body = z.object({ outcome: z.enum(['success', 'failure', 'restricted']) }).strict()

export const POST = route<{ id: string }>('admin', async ({ req, params }) => {
  assertDemoToolsEnabled()
  const { id } = parseParams(params, idParam)
  const { outcome } = await parseJson(req, body)

  const merchant = await getMerchantById(id)
  if (!merchant?.stripe_account_id)
    throw new HttpError(409, 'NO_STRIPE_ACCOUNT', 'Merchant has no Stripe account')

  const stripe = getStripe()
  await stripe.accounts.update(
    merchant.stripe_account_id,
    stripeTestFixtures.testVerificationOutcome(outcome, stripeTestFixtures.DEMO_BUSINESS_URL),
  )
  const account = await stripe.accounts.retrieve(merchant.stripe_account_id)
  const status = deriveOnboardingStatus(account)
  const disabledReason = account.requirements?.disabled_reason ?? null

  await updateMerchantStatus(merchant.id, {
    onboarding_status: status,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    disabled_reason: disabledReason,
  })

  return {
    success: true,
    status,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    disabled_reason: disabledReason,
    requirements_currently_due: account.requirements?.currently_due ?? [],
  }
})
