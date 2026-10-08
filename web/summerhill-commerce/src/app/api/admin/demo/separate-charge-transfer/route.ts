import { z } from 'zod'

import { getMerchantById } from '@/modules/merchant'
import { getStripe } from '@/modules/payments'
import { calculatePlatformFee } from '@/modules/pricing'
import { getConfig } from '@/server/config'
import { assertDemoToolsEnabled, HttpError, parseJson, route } from '@/server/http'

const body = z.object({ amountCents: z.number().int().min(50).max(1_000_000) }).strict()

export const POST = route('admin', async ({ req, requestId }) => {
  assertDemoToolsEnabled()
  const { amountCents } = await parseJson(req, body)

  const merchant = await getMerchantById(getConfig().DEFAULT_MERCHANT_ID)
  if (!merchant?.stripe_account_id)
    throw new HttpError(409, 'NO_STRIPE_ACCOUNT', 'Merchant has no Stripe account')

  const stripe = getStripe()
  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: 'cad',
      payment_method: 'pm_card_visa', // Stripe test payment method
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    },
    { idempotencyKey: `demo-sct:pi:${requestId}` },
  )

  const { platformFeeCents, merchantNetCents } = calculatePlatformFee(amountCents)
  const transfer = await stripe.transfers.create(
    {
      amount: merchantNetCents,
      currency: 'cad',
      destination: merchant.stripe_account_id,
      source_transaction: pi.latest_charge as string,
    },
    { idempotencyKey: `demo-sct:transfer:${requestId}` },
  )

  return {
    success: true,
    paymentIntentId: pi.id,
    transferId: transfer.id,
    amountCents,
    platformFeeCents,
    merchantNetCents,
  }
})
