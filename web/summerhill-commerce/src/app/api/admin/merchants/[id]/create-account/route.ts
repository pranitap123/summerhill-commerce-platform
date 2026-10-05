import {
  getMerchantById,
  stripeTestFixtures,
  updateMerchantStatus,
  updateMerchantStripeAccount,
} from '@/modules/merchant'
import { getStripe } from '@/modules/payments'
import { clientIp, HttpError, idParam, parseParams, route } from '@/server/http'

/** Creates a Custom connected account for a merchant (test mode; ADR-0011 decides the live flow). */
export const POST = route<{ id: string }>('admin', async ({ req, params, log }) => {
  const { id } = parseParams(params, idParam)
  const merchant = await getMerchantById(id)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  if (merchant.stripe_account_id)
    throw new HttpError(409, 'ALREADY_EXISTS', 'Merchant already has a Stripe account', {
      accountId: merchant.stripe_account_id,
    })

  const ip = clientIp(req)
  if (!ip)
    throw new HttpError(
      400,
      'CLIENT_IP_UNKNOWN',
      'Cannot determine the client IP for terms acceptance',
    )

  const account = await getStripe().accounts.create(
    {
      type: 'custom',
      country: 'CA',
      business_type: 'company',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: merchant.name, url: stripeTestFixtures.DEMO_BUSINESS_URL },
      company: stripeTestFixtures.testCompany(merchant.name),
      tos_acceptance: stripeTestFixtures.testTosAcceptance(ip, req.headers.get('user-agent')),
      metadata: { merchant_id: String(merchant.id) },
    },
    // One account per merchant, even if the request is retried.
    { idempotencyKey: `create-account:merchant:${merchant.id}` },
  )

  await updateMerchantStripeAccount(merchant.id, account.id)
  await updateMerchantStatus(merchant.id, { onboarding_status: 'submitted' })
  log.info({ merchantId: merchant.id, accountId: account.id }, 'connected account created')
  return { success: true, accountId: account.id, status: 'submitted' }
})
