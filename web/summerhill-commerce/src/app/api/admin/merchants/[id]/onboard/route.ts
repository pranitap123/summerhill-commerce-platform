import {
  deriveOnboardingStatus,
  getMerchantById,
  stripeTestFixtures,
  updateMerchantStatus,
} from '@/modules/merchant'
import { getStripe } from '@/modules/payments'
import { HttpError, idParam, parseParams, route } from '@/server/http'

export const POST = route<{ id: string }>('admin', async ({ params }) => {
  const { id } = parseParams(params, idParam)
  const merchant = await getMerchantById(id)
  if (!merchant?.stripe_account_id)
    throw new HttpError(
      409,
      'NO_STRIPE_ACCOUNT',
      'Merchant has no Stripe account; call create-account first',
    )

  const stripe = getStripe()
  const accountId = merchant.stripe_account_id

  const person = stripeTestFixtures.testRepresentative()
  const existing = await stripe.accounts.listPersons(accountId)
  if (existing.data.length > 0)
    await stripe.accounts.updatePerson(accountId, existing.data[0].id, person)
  else await stripe.accounts.createPerson(accountId, person)

  await stripe.accounts.update(accountId, stripeTestFixtures.testCompanyVerification())

  const banks = await stripe.accounts.listExternalAccounts(accountId, { object: 'bank_account' })
  if (banks.data.length === 0)
    await stripe.accounts.createExternalAccount(accountId, {
      external_account: stripeTestFixtures.testBankAccount(),
    })

  const account = await stripe.accounts.retrieve(accountId)
  await updateMerchantStatus(merchant.id, {
    onboarding_status: deriveOnboardingStatus(account),
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    disabled_reason: account.requirements?.disabled_reason ?? null,
  })

  return {
    success: true,
    accountId,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    requirements_currently_due: account.requirements?.currently_due ?? [],
  }
})
