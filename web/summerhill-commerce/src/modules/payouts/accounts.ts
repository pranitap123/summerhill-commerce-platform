import {
  deriveOnboardingStatus,
  getMerchantById,
  setStripeAccount,
  updateMerchantStatus,
  type Merchant,
} from '@/modules/merchant'
import { audit, type AuditContext } from '@/modules/ops'
import { getGateway } from '@/modules/payments'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Merchant onboarding (G5-02, ADR-0011): Stripe **Express** accounts with Stripe-hosted
 * onboarding (Account Links). KYC, bank details and terms acceptance happen on Stripe's pages,
 * so bank changes never go through our UI (threat T14). Status follows `account.updated`
 * webhooks; `refreshAccountStatus` is the manual "check now".
 * With the payment simulator the link goes to /simulator/onboarding/{account}.
 */
export async function startOnboarding(
  ctx: AuditContext,
  merchantId: number,
): Promise<{ accountId: string; url: string }> {
  const merchant = await getMerchantById(merchantId)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  if (merchant.lifecycle_status === 'offboarded')
    throw new HttpError(409, 'LIFECYCLE_CONFLICT', 'This merchant is offboarded')
  const gateway = getGateway()
  let accountId = merchant.stripe_account_id
  if (!accountId) {
    accountId = (
      await gateway.createExpressAccount(
        { merchantId, name: merchant.name },
        `express-account:merchant:${merchantId}`,
      )
    ).id
    await setStripeAccount(merchantId, accountId, 'express')
  }
  const base = `${getConfig().NEXT_PUBLIC_SERVER_URL}/ops/merchants/${merchantId}`
  const url = await gateway.createOnboardingLink(
    accountId,
    `${base}?onboarding=refresh`,
    `${base}?onboarding=done`,
  )
  await audit(getDb(), {
    ...ctx,
    action: 'merchant.onboarding_link',
    targetType: 'merchant',
    targetId: merchantId,
    data: { accountId, created: !merchant.stripe_account_id },
  })
  return { accountId, url }
}

/** Reads the account from Stripe now (normally `account.updated` does this). */
export async function refreshAccountStatus(merchantId: number): Promise<Merchant> {
  const merchant = await getMerchantById(merchantId)
  if (!merchant?.stripe_account_id)
    throw new HttpError(409, 'NO_STRIPE_ACCOUNT', 'Merchant has no Stripe account')
  const account = await getGateway().retrieveAccount(merchant.stripe_account_id)
  await updateMerchantStatus(merchantId, {
    onboarding_status: deriveOnboardingStatus({
      charges_enabled: account.chargesEnabled,
      requirements: { disabled_reason: account.disabledReason },
    }),
    charges_enabled: account.chargesEnabled,
    payouts_enabled: account.payoutsEnabled,
    disabled_reason: account.disabledReason,
    requirements_due: account.currentlyDue,
  })
  return (await getMerchantById(merchantId))!
}
