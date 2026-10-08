import type Stripe from 'stripe'

import { getCartItems, QUOTE_MAX_AGE_MS, quoteCart, type Cart } from '@/modules/cart'
import { getProductsByIds } from '@/modules/catalog'
import type { SessionUser } from '@/modules/identity'
import { getMerchantById } from '@/modules/merchant'
import { emit, isEnabled, type Actor } from '@/modules/ops'
import {
  findPendingOrderForCart,
  getOrder,
  insertPendingOrder,
  orderAccessToken,
  recordOrderEvent,
  transition,
  transitionInTx,
  type LineOptions,
  type Order,
} from '@/modules/ordering'
import { toPublicQuote, type Quote } from '@/modules/pricing'
import { getLocationSettings, holdSlot } from '@/modules/scheduling'
import { getConfig } from '@/server/config'
import { currentTraceCarrier } from '@/server/tracing'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { getLogger } from '@/server/logger'

import { voidOrder } from './capture'
import { getGateway } from './gateway'
import {
  getPaymentForOrder,
  insertPayment,
  setCheckoutSession,
  setPaymentStatus,
} from './repository'

export const HOLD_MESSAGE =
  'Weighed items are estimated. We place a temporary hold and charge only the final amount after your order is packed.'
export const SESSION_TTL_MS = 30 * 60_000

export const SLOT_HOLD_TTL_MS = SESSION_TTL_MS + 10 * 60_000

export interface CheckoutInput {
  cart: Cart
  user: SessionUser | null
  email: string
  pickupName: string | null
  quoteHash: string

  slotId: number
  requestId: string
  now?: Date
}

export interface CheckoutResult {
  publicId: string
  checkoutUrl: string

  accessToken: string
}

const formatLb = (mlb: number) => `${(mlb / 1000).toFixed(2)} lb`

export function buildCheckoutLineItems(
  quote: Pick<Quote, 'lines' | 'taxCents' | 'depositCents' | 'weightBufferCents'>,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const item = (name: string, unitAmount: number, quantity: number, description?: string) => ({
    quantity,
    price_data: {
      currency: 'cad',
      unit_amount: unitAmount,
      product_data: { name: name.slice(0, 250), ...(description ? { description } : {}) },
    },
  })
  const items = quote.lines.map((l) => {
    const promo = l.promoLabel
      ? `${l.promoLabel}: was $${(l.regularUnitPriceCents / 100).toFixed(2)}`
      : undefined
    if (l.isWeighed)
      return item(
        `${l.name} (est. ${formatLb(l.estimatedWeightMlb!)})`,
        l.lineTotalCents,
        1,
        `$${(l.unitPriceCents / 100).toFixed(2)}/lb, estimated; charged by actual weight${promo ? ` · ${promo}` : ''}`,
      )
    return item(l.name, l.unitPriceCents, l.quantity!, promo)
  })
  if (quote.depositCents > 0) items.push(item('Container deposits', quote.depositCents, 1))
  if (quote.taxCents > 0) items.push(item('HST (13%)', quote.taxCents, 1))
  if (quote.weightBufferCents > 0)
    items.push(
      item(
        'Weighed-item hold, released after weighing',
        quote.weightBufferCents,
        1,
        'Temporary hold only; you are charged the final weighed amount',
      ),
    )
  return items
}

export function lineItemsTotal(items: Stripe.Checkout.SessionCreateParams.LineItem[]): number {
  return items.reduce((s, i) => s + i.price_data!.unit_amount! * i.quantity!, 0)
}

async function refuseStaleQuote(cart: Cart, quote: Quote, clientHash: string, now: Date) {
  if (quote.hash !== clientHash)
    throw new HttpError(
      409,
      'PRICE_CHANGED',
      'Prices or availability changed. Please review your cart.',
      {
        quote: toPublicQuote(quote),
      },
    )
  const fresh =
    cart.lastQuoteHash === quote.hash &&
    cart.lastQuotedAt !== null &&
    now.getTime() - cart.lastQuotedAt.getTime() <= QUOTE_MAX_AGE_MS
  if (!fresh)
    throw new HttpError(
      409,
      'QUOTE_EXPIRED',
      'Please review your cart total again before paying.',
      {
        quote: toPublicQuote(quote),
      },
    )
}

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const now = input.now ?? new Date()
  const log = getLogger().child({ requestId: input.requestId, cartId: input.cart.id })
  if (!(await isEnabled('checkout.enabled')))
    throw new HttpError(503, 'CHECKOUT_DISABLED', 'Checkout is temporarily unavailable')

  const { quote } = await quoteCart(input.cart, { now, remember: false })
  await refuseStaleQuote(input.cart, quote, input.quoteHash, now)
  if (!quote.canCheckout)
    throw new HttpError(422, 'CART_INVALID', 'Your cart needs attention before checkout', {
      issues: quote.issues,
    })

  const merchant = await getMerchantById(quote.merchantId!)
  if (!merchant) throw new HttpError(422, 'CART_INVALID', 'This store no longer exists')
  if (!merchant.accepting_orders)
    throw new HttpError(422, 'MERCHANT_PAUSED', 'This store is not taking orders right now')
  const settings = await getLocationSettings(quote.locationId!)
  if (!settings) throw new HttpError(422, 'CART_INVALID', 'This store no longer exists')
  if (settings.paused)
    throw new HttpError(422, 'MERCHANT_PAUSED', 'This store is not taking orders right now')

  const simulated = getConfig().PAYMENT_PROVIDER === 'simulator'
  const destination = merchant.stripe_account_id ?? (simulated ? 'acct_simulated' : null)
  if (!destination || (!merchant.charges_enabled && !simulated))
    throw new HttpError(
      503,
      'MERCHANT_UNAVAILABLE',
      'This store is not able to accept payments right now',
    )

  const actor: Actor = input.user
    ? { type: 'customer', id: String(input.user.id) }
    : { type: 'customer', id: null }

  const pending = await findPendingOrderForCart(input.cart.id)
  if (pending) {
    const payment = await getPaymentForOrder(pending.id)
    const young = now.getTime() - pending.createdAt.getTime() < SESSION_TTL_MS - 5 * 60_000
    if (
      pending.quoteHash === quote.hash &&
      pending.slotId === input.slotId &&
      payment?.checkoutUrl &&
      young &&
      pending.email === input.email
    )
      return {
        publicId: pending.publicId,
        checkoutUrl: payment.checkoutUrl,
        accessToken: orderAccessToken(pending, now),
      }
    await supersede(pending, payment?.checkoutSessionId ?? null, payment?.id ?? null, actor)
  }

  const items = await getCartItems(input.cart.id)
  const itemAvailableDays = (await getProductsByIds(items.map((i) => i.productId))).map(
    (p) => p.availableDays,
  )
  const lineOptions = new Map<string, LineOptions>(
    items.map((i) => [
      i.productId,
      {
        replacementPreference: i.replacementPreference,
        replacementProductIds: i.replacementProductIds,
        note: i.note,
      },
    ]),
  )

  const { order, paymentId } = await withTransaction(async (tx) => {
    const order = await insertPendingOrder(tx, {
      quote,
      cartId: input.cart.id,
      userId: input.user ? String(input.user.id) : null,
      email: input.email,
      pickupName: input.pickupName,
      lineOptions,
    })
    const paymentId = await insertPayment(tx, order.id)
    const slot = await holdSlot(tx, {
      slotId: input.slotId,
      orderId: order.id,
      settings,
      itemAvailableDays,
      now,
      expiresAt: new Date(now.getTime() + SLOT_HOLD_TTL_MS),
    })
    await tx.query(
      `INSERT INTO commerce.order_events (order_id, type, to_status, actor_type, actor_id, data, request_id)
       VALUES ($1, 'created', 'pending_payment', $2, $3, $4, $5)`,
      [
        order.id,
        actor.type,
        actor.id,
        {
          authorizationCents: quote.authorizationCents,
          quoteHash: quote.hash,
          slotId: slot.id,
          pickupStartsAt: slot.startsAt.toISOString(),
        },
        input.requestId,
      ],
    )
    await emit(tx, 'order.pending_payment', order.id, {
      orderId: order.id,
      publicId: order.publicId,
    })
    return { order, paymentId }
  })

  const config = getConfig()
  const accessToken = orderAccessToken(order, now)
  const lineItems = buildCheckoutLineItems(quote)
  if (lineItemsTotal(lineItems) !== quote.authorizationCents)
    throw new Error('checkout line items do not add up to the authorisation amount')
  const metadata = {
    order_id: String(order.id),
    public_id: order.publicId,

    ...currentTraceCarrier(),
  }

  let session
  try {
    session = await getGateway().createCheckoutSession(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        customer_email: input.email,
        client_reference_id: order.publicId,
        metadata,
        expires_at: Math.floor((now.getTime() + SESSION_TTL_MS) / 1000),
        custom_text: { submit: { message: HOLD_MESSAGE } },
        payment_intent_data: {
          capture_method: 'manual',

          on_behalf_of: destination,
          transfer_data: { destination },

          application_fee_amount: quote.fee.applicationFeeCents,
          description: `Order ${order.publicId}`,
          metadata,
        },

        ...(config.STRIPE_CARD_FEATURES === 'if_available'
          ? {
              payment_method_options: {
                card: {
                  request_overcapture: 'if_available',
                  request_incremental_authorization: 'if_available',
                },
              },
            }
          : {}),
        success_url: `${config.NEXT_PUBLIC_SERVER_URL}/orders/${order.publicId}?t=${encodeURIComponent(accessToken)}&from=checkout`,
        cancel_url: `${config.NEXT_PUBLIC_SERVER_URL}/cart?checkout=cancelled`,
      },
      `checkout:${order.id}`,
    )
  } catch (err) {
    log.error({ err, orderId: order.id }, 'checkout session creation failed')
    await transition(
      order.id,
      'pending_payment',
      'abandoned',
      { type: 'system', id: null },
      {
        reason: 'payment_provider_error',
      },
    ).catch(() => {})
    throw new HttpError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payments are temporarily unavailable. Please try again.',
    )
  }
  await setCheckoutSession(getDb(), paymentId, session.id, session.url)
  if (!session.url) throw new Error('Stripe returned a checkout session without a URL')
  log.info({ orderId: order.id, publicId: order.publicId }, 'checkout started')
  return { publicId: order.publicId, checkoutUrl: session.url, accessToken }
}

async function supersede(
  pending: Order,
  sessionId: string | null,
  paymentId: number | null,
  actor: Actor,
): Promise<void> {
  if (sessionId) {
    const outcome = await getGateway().expireCheckoutSession(sessionId)
    if (outcome === 'complete')
      throw new HttpError(
        409,
        'CHECKOUT_ALREADY_COMPLETED',
        'This cart has already been paid for',
        {
          publicId: pending.publicId,
        },
      )
  }
  await withTransaction(async (tx) => {
    const current = await getOrder(pending.id, tx)
    if (current?.status !== 'pending_payment') return
    if (paymentId) await setPaymentStatus(tx, paymentId, 'expired')
    await recordOrderEvent(tx, pending.id, 'checkout_superseded', actor)
    await transitionInTx(tx, pending.id, 'pending_payment', 'abandoned', actor, {
      reason: 'superseded_by_new_checkout',
    })
  })
}

export async function sweepAbandonedCheckouts(now: Date = new Date()): Promise<number> {
  const { rows } = await getDb().query<{ id: string }>(
    `SELECT id FROM commerce.orders WHERE status = 'pending_payment' AND created_at < $1`,
    [new Date(now.getTime() - SESSION_TTL_MS - 15 * 60_000)],
  )
  let abandoned = 0
  for (const r of rows) {
    try {
      await voidOrder(Number(r.id), { type: 'system', id: null }, 'checkout_timeout')
      abandoned++
    } catch (err) {
      getLogger().warn({ err, orderId: r.id }, 'abandoned-checkout sweep skipped an order')
    }
  }
  return abandoned
}
