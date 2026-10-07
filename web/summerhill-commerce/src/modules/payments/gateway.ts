import Stripe from 'stripe'

import { stripeTestFixtures } from '@/modules/merchant'
import { getConfig } from '@/server/config'

import { simulatedGateway } from './simulator'
import { getStripe } from './stripe'

/**
 * The narrow set of Stripe operations the marketplace uses: checkout, capture, void and webhooks
 * (G2), and the back office (G5): refunds and transfer reversals, connected-account onboarding,
 * balances and payouts, balance transactions for reconciliation, dispute evidence.
 * Production code talks to Stripe through `getGateway()`; integration tests swap in a fake with
 * `setGatewayForTests`, so the whole flow runs in CI without network access. Webhook signatures
 * are always verified with Stripe's real algorithm, including in tests.
 */
export interface PaymentIntentInfo {
  id: string
  status: Stripe.PaymentIntent.Status
  amountCapturableCents: number
  amountReceivedCents: number
  applicationFeeCents: number | null
  chargeId: string | null
  captureBefore: Date | null
  overcaptureStatus: 'available' | 'unavailable' | null
  overcaptureMaximumCents: number | null
  incrementalAuthorizationStatus: 'available' | 'unavailable' | null
  extendedAuthorizationStatus: 'enabled' | 'disabled' | null
  /** Stripe's processing fee on the charge, once the balance transaction exists. */
  processingFeeCents: number | null
}

export interface CheckoutSessionInfo {
  id: string
  url: string | null
  expiresAt: Date
}

export interface RefundInfo {
  id: string
  status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action'
  amountCents: number
  /** Set when the refund reversed the destination transfer (reverse_transfer). */
  transferReversalId: string | null
  /**
   * Total application fee refunded on this charge so far (Stripe's application fee
   * `amount_refunded`), when the fee was touched; the caller derives this refund's share.
   */
  applicationFeeRefundedTotalCents: number | null
  failureReason: string | null
}

export interface TransferReversalInfo {
  id: string
  amountCents: number
  applicationFeeRefundedTotalCents: number | null
}

export interface ConnectedAccountInfo {
  id: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  disabledReason: string | null
  currentlyDue: string[]
}

export interface PayoutInfo {
  id: string
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled'
  arrivalDate: Date | null
}

/** One line of the platform's Stripe balance history (PAYMENTS §10). */
export interface BalanceTransaction {
  id: string
  /** Stripe's type: charge, payment, refund, transfer, transfer_refund, adjustment, … */
  type: string
  /** The object behind it (ch_…, re_…, tr_…, trr_…, dp_…), when there is one. */
  sourceId: string | null
  amountCents: number
  feeCents: number
  created: Date
}

export interface PaymentGateway {
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
    idempotencyKey: string,
  ): Promise<CheckoutSessionInfo>
  /** Expires an open session; a session that is already complete or expired is left alone. */
  expireCheckoutSession(id: string): Promise<'expired' | 'complete' | 'already_expired'>
  retrievePaymentIntent(id: string): Promise<PaymentIntentInfo>
  capturePaymentIntent(
    id: string,
    amounts: { amountToCaptureCents: number; applicationFeeCents: number },
    idempotencyKey: string,
  ): Promise<PaymentIntentInfo>
  cancelPaymentIntent(id: string, idempotencyKey: string): Promise<PaymentIntentInfo>

  // ---- back office (G5)
  refund(
    params: {
      paymentIntentId: string
      amountCents: number
      reverseTransfer: boolean
      refundApplicationFee: boolean
      metadata: Record<string, string>
    },
    idempotencyKey: string,
  ): Promise<RefundInfo>
  /** Pulls part of a destination charge's transfer back from the merchant (split liability). */
  reverseTransfer(
    params: {
      chargeId: string
      amountCents: number
      refundApplicationFee: boolean
      metadata: Record<string, string>
    },
    idempotencyKey: string,
  ): Promise<TransferReversalInfo>
  createExpressAccount(
    params: { merchantId: number; name: string },
    idempotencyKey: string,
  ): Promise<{ id: string }>
  /**
   * A Custom connected account (ADR-0012): the platform supplies the company details and the terms
   * acceptance. Test mode uses Stripe's documented test values.
   */
  createCustomAccount(
    params: { merchantId: number; name: string; tosIp: string | null; tosUserAgent: string | null },
    idempotencyKey: string,
  ): Promise<{ id: string }>
  createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>
  retrieveAccount(accountId: string): Promise<ConnectedAccountInfo>
  retrieveBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>
  createPayout(
    accountId: string,
    amountCents: number,
    metadata: Record<string, string>,
    idempotencyKey: string,
  ): Promise<PayoutInfo>
  updatePayoutSchedule(
    accountId: string,
    interval: 'manual' | 'daily' | 'weekly' | 'monthly',
  ): Promise<void>
  listBalanceTransactions(range: { from: Date; to: Date }): Promise<BalanceTransaction[]>
  submitDisputeEvidence(
    disputeId: string,
    evidence: Record<string, string>,
  ): Promise<{ status: string }>
}

const EXPAND = ['latest_charge.balance_transaction']

export function toPaymentIntentInfo(pi: Stripe.PaymentIntent): PaymentIntentInfo {
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  const card = charge?.payment_method_details?.card
  const balance =
    charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
  const fee = typeof pi.application_fee_amount === 'number' ? pi.application_fee_amount : null
  return {
    id: pi.id,
    status: pi.status,
    amountCapturableCents: pi.amount_capturable,
    amountReceivedCents: pi.amount_received,
    applicationFeeCents: fee,
    chargeId: charge?.id ?? (typeof pi.latest_charge === 'string' ? pi.latest_charge : null),
    captureBefore: card?.capture_before ? new Date(card.capture_before * 1000) : null,
    overcaptureStatus: card?.overcapture?.status ?? null,
    overcaptureMaximumCents: card?.overcapture?.maximum_amount_capturable ?? null,
    incrementalAuthorizationStatus: card?.incremental_authorization?.status ?? null,
    extendedAuthorizationStatus: card?.extended_authorization?.status ?? null,
    processingFeeCents: balance ? balance.fee : null,
  }
}

export const stripeGateway: PaymentGateway = {
  async createCheckoutSession(params, idempotencyKey) {
    const s = await getStripe().checkout.sessions.create(params, { idempotencyKey })
    return { id: s.id, url: s.url, expiresAt: new Date(s.expires_at * 1000) }
  },
  async expireCheckoutSession(id) {
    const s = await getStripe().checkout.sessions.retrieve(id)
    if (s.status === 'complete') return 'complete'
    if (s.status === 'expired') return 'already_expired'
    await getStripe().checkout.sessions.expire(id)
    return 'expired'
  },
  async retrievePaymentIntent(id) {
    return toPaymentIntentInfo(await getStripe().paymentIntents.retrieve(id, { expand: EXPAND }))
  },
  async capturePaymentIntent(id, amounts, idempotencyKey) {
    const pi = await getStripe().paymentIntents.capture(
      id,
      {
        amount_to_capture: amounts.amountToCaptureCents,
        application_fee_amount: amounts.applicationFeeCents,
        expand: EXPAND,
      },
      { idempotencyKey },
    )
    return toPaymentIntentInfo(pi)
  },
  async cancelPaymentIntent(id, idempotencyKey) {
    const pi = await getStripe().paymentIntents.cancel(
      id,
      { cancellation_reason: 'requested_by_customer', expand: EXPAND },
      { idempotencyKey },
    )
    return toPaymentIntentInfo(pi)
  },

  async refund(params, idempotencyKey) {
    const stripe = getStripe()
    const r = await stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        amount: params.amountCents,
        reverse_transfer: params.reverseTransfer,
        refund_application_fee: params.refundApplicationFee,
        metadata: params.metadata,
      },
      { idempotencyKey },
    )
    return {
      id: r.id,
      status: (r.status ?? 'pending') as RefundInfo['status'],
      amountCents: r.amount,
      transferReversalId:
        typeof r.transfer_reversal === 'string'
          ? r.transfer_reversal
          : (r.transfer_reversal?.id ?? null),
      applicationFeeRefundedTotalCents: params.refundApplicationFee
        ? await applicationFeeRefunded(r.charge)
        : null,
      failureReason: r.failure_reason ?? null,
    }
  },
  async reverseTransfer(params, idempotencyKey) {
    const stripe = getStripe()
    const charge = await stripe.charges.retrieve(params.chargeId)
    const transfer = typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id
    if (!transfer) throw new Error(`charge ${params.chargeId} has no destination transfer`)
    const reversal = await stripe.transfers.createReversal(
      transfer,
      {
        amount: params.amountCents,
        refund_application_fee: params.refundApplicationFee,
        metadata: params.metadata,
      },
      { idempotencyKey },
    )
    return {
      id: reversal.id,
      amountCents: reversal.amount,
      applicationFeeRefundedTotalCents: params.refundApplicationFee
        ? await applicationFeeRefunded(params.chargeId)
        : null,
    }
  },
  async createExpressAccount(params, idempotencyKey) {
    const account = await getStripe().accounts.create(
      {
        type: 'express',
        country: 'CA',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: params.name, mcc: '5411' },
        metadata: { merchant_id: String(params.merchantId) },
      },
      { idempotencyKey },
    )
    return { id: account.id }
  },
  async createCustomAccount(params, idempotencyKey) {
    if (!params.tosIp) throw new Error('Cannot record terms acceptance without the client IP')
    const account = await getStripe().accounts.create(
      {
        type: 'custom',
        country: 'CA',
        business_type: 'company',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: {
          name: params.name,
          url: stripeTestFixtures.DEMO_BUSINESS_URL,
          mcc: '5411',
        },
        company: stripeTestFixtures.testCompany(params.name),
        tos_acceptance: stripeTestFixtures.testTosAcceptance(params.tosIp, params.tosUserAgent),
        metadata: { merchant_id: String(params.merchantId) },
      },
      { idempotencyKey },
    )
    return { id: account.id }
  },
  async createOnboardingLink(accountId, refreshUrl, returnUrl) {
    const link = await getStripe().accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: refreshUrl,
      return_url: returnUrl,
    })
    return link.url
  },
  async retrieveAccount(accountId) {
    return toAccountInfo(await getStripe().accounts.retrieve(accountId))
  },
  async retrieveBalance(accountId) {
    const b = await getStripe().balance.retrieve({}, { stripeAccount: accountId })
    const cad = (list: Stripe.Balance.Available[]) =>
      list.filter((x) => x.currency === 'cad').reduce((sum, x) => sum + x.amount, 0)
    return { availableCents: cad(b.available), pendingCents: cad(b.pending) }
  },
  async createPayout(accountId, amountCents, metadata, idempotencyKey) {
    const p = await getStripe().payouts.create(
      { amount: amountCents, currency: 'cad', metadata },
      { stripeAccount: accountId, idempotencyKey },
    )
    return {
      id: p.id,
      status: p.status as PayoutInfo['status'],
      arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000) : null,
    }
  },
  async updatePayoutSchedule(accountId, interval) {
    await getStripe().accounts.update(accountId, {
      settings: { payouts: { schedule: { interval } } },
    })
  },
  async listBalanceTransactions({ from, to }) {
    const out: BalanceTransaction[] = []
    for await (const t of getStripe().balanceTransactions.list({
      created: { gte: Math.floor(from.getTime() / 1000), lt: Math.floor(to.getTime() / 1000) },
      limit: 100,
    }))
      out.push({
        id: t.id,
        type: t.type,
        sourceId: typeof t.source === 'string' ? t.source : (t.source?.id ?? null),
        amountCents: t.amount,
        feeCents: t.fee,
        created: new Date(t.created * 1000),
      })
    return out
  },
  async submitDisputeEvidence(disputeId, evidence) {
    const d = await getStripe().disputes.update(disputeId, { evidence, submit: true })
    return { status: d.status }
  },
}

export function toAccountInfo(account: Stripe.Account): ConnectedAccountInfo {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    disabledReason: account.requirements?.disabled_reason ?? null,
    currentlyDue: account.requirements?.currently_due ?? [],
  }
}

/** The application fee refunded so far on a destination charge (for the fee-refund share). */
async function applicationFeeRefunded(
  charge: string | Stripe.Charge | null | undefined,
): Promise<number | null> {
  const id = typeof charge === 'string' ? charge : charge?.id
  if (!id) return null
  const c = await getStripe().charges.retrieve(id, { expand: ['application_fee'] })
  return typeof c.application_fee === 'object' && c.application_fee
    ? c.application_fee.amount_refunded
    : null
}

let override: PaymentGateway | undefined
let simulator: PaymentGateway | undefined

/** Stripe, or the payment simulator when PAYMENT_PROVIDER=simulator (G4-18; never in production). */
export function getGateway(): PaymentGateway {
  if (override) return override
  const config = getConfig()
  if (config.PAYMENT_PROVIDER === 'simulator')
    return (simulator ??= simulatedGateway(config.NEXT_PUBLIC_SERVER_URL))
  return stripeGateway
}

/** Test hook: replace the gateway (pass undefined to restore Stripe). */
export function setGatewayForTests(gateway: PaymentGateway | undefined): void {
  override = gateway
}

/**
 * Verifies a webhook signature over the RAW body (G2-08). Uses Stripe's algorithm locally; no
 * network call. Throws on a bad or stale signature.
 */
export function verifyWebhook(rawBody: string, signature: string, secret: string): Stripe.Event {
  return getStripe().webhooks.constructEvent(rawBody, signature, secret)
}
