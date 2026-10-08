import { markCartConverted } from '@/modules/cart'
import { audit, raiseAlert, type Actor } from '@/modules/ops'
import {
  getOrder,
  getOrderForUpdate,
  getOrderLines,
  recordOrderEvent,
  saveFinalAmounts,
  transitionInTx,
  VOIDABLE_STATUSES,
  type Order,
  type OrderLine,
} from '@/modules/ordering'
import {
  finalizeOrder,
  getFeeSchedule,
  planCapture,
  type CapturePlan,
  type FinalAmounts,
  type FinalizableLine,
} from '@/modules/pricing'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { getLogger } from '@/server/logger'

import { getGateway, type PaymentIntentInfo } from './gateway'
import { postJournal } from './ledger'
import { postCapture } from './ledgerRules'
import {
  getPaymentForOrder,
  markAuthorized,
  markCaptured,
  recordCaptureAttempt,
  setPaymentStatus,
  type Payment,
} from './repository'

const SYSTEM: Actor = { type: 'system', id: null }

export async function captureOrder(orderId: number): Promise<'captured' | 'voided' | 'skipped'> {
  const log = getLogger().child({ job: 'payment.capture', orderId })
  const order = await getOrder(orderId)
  if (!order) throw new Error(`order ${orderId} not found`)
  if (order.status !== 'picked' && order.status !== 'payment_issue') {
    log.info({ status: order.status }, 'capture skipped: order is not waiting for capture')
    return 'skipped'
  }
  const payment = await getPaymentForOrder(orderId)
  if (!payment?.paymentIntentId || payment.amountAuthorizedCents === null)
    throw new Error(`order ${orderId} has no authorised payment`)

  const { final, plan } = await projectCapture(order, await getOrderLines(orderId), payment)

  if (plan.amountToCaptureCents === 0) {
    await voidOrder(orderId, SYSTEM, 'nothing_to_capture')
    return 'voided'
  }

  let pi: PaymentIntentInfo
  if (payment.status === 'captured') {
    pi = await getGateway().retrievePaymentIntent(payment.paymentIntentId)
  } else {
    try {
      pi = await getGateway().capturePaymentIntent(
        payment.paymentIntentId,
        {
          amountToCaptureCents: plan.amountToCaptureCents,
          applicationFeeCents: plan.applicationFeeCents,
        },
        `capture:${orderId}`,
      )
    } catch (err) {
      await recordCaptureAttempt(payment.id, err instanceof Error ? err.message : String(err))
      throw err
    }
  }
  const hstOnCommission = Math.min(final.fee.hstOnCommissionCents, plan.applicationFeeCents)

  await withTransaction(async (tx) => {
    await saveFinalAmounts(tx, orderId, {
      lines: final.lines,
      itemSubtotalCents: final.itemSubtotalCents,
      depositCents: final.depositCents,
      taxCents: final.taxCents,
      totalCents: final.totalCents,
      feeCents: plan.applicationFeeCents,
    })
    await markCaptured(tx, payment.id, pi, plan.applicationFeeCents)
    await postJournal(tx, {
      key: `capture:${orderId}`,
      event: 'capture',
      orderId,
      externalRef: pi.chargeId,
      entries: postCapture({
        merchantId: order.merchantId,
        capturedCents: pi.amountReceivedCents,
        applicationFeeCents: plan.applicationFeeCents,
        hstOnCommissionCents: hstOnCommission,
        processingFeeCents: pi.processingFeeCents,
      }),
    })
    await transitionInTx(tx, orderId, order.status, 'ready', SYSTEM, {
      data: {
        capturedCents: pi.amountReceivedCents,
        applicationFeeCents: plan.applicationFeeCents,
        releasedCents: payment.amountAuthorizedCents! - pi.amountReceivedCents,
        usedOvercapture: plan.usesOvercapture,
      },
    })
    if (plan.shortfallCents > 0)
      await raiseAlert(tx, {
        kind: 'capture.shortfall',
        dedupeKey: `capture-shortfall:${orderId}`,
        severity: 'warning',
        message: `Order ${order.publicId}: final total exceeded the authorisation; ${plan.shortfallCents}¢ absorbed`,
        data: { orderId, shortfallCents: plan.shortfallCents },
      })
  })
  log.info({ captured: pi.amountReceivedCents, fee: plan.applicationFeeCents }, 'captured')
  return 'captured'
}

export function finalizableLines(lines: OrderLine[]): FinalizableLine[] {
  const lineNoById = new Map(lines.map((l) => [l.id, l.lineNo]))
  return lines.map((l) => ({
    lineNo: l.lineNo,
    status: l.status,
    isWeighed: l.isWeighed,
    unitPriceCents: l.unitPriceCents,
    taxRateBp: l.taxRateBp,
    quantity: l.quantity,
    lineTotalCents: l.lineTotalCents,
    depositCents: l.depositCents,
    pickedQuantity: l.pickedQuantity,
    actualWeightMlb: l.actualWeightMlb,
    labelPriceCents: l.labelPriceCents,
    substitutesLineNo: l.substitutesLineId === null ? null : lineNoById.get(l.substitutesLineId)!,
  }))
}

export async function projectCapture(
  order: Order,
  lines: OrderLine[],
  payment: Pick<
    Payment,
    'amountAuthorizedCents' | 'overcaptureStatus' | 'overcaptureMaximumCents'
  > | null,
): Promise<{ final: FinalAmounts; plan: CapturePlan; ceilingCents: number }> {
  const final = finalizeOrder(finalizableLines(lines), await getFeeSchedule(order.feeScheduleId))
  const authorized = payment?.amountAuthorizedCents ?? order.authorizationCents
  const overcapture =
    payment?.overcaptureStatus === 'available' ? payment.overcaptureMaximumCents : null
  const plan = planCapture(final, authorized, overcapture)
  return { final, plan, ceilingCents: Math.max(authorized, overcapture ?? 0) }
}

export async function onCaptureDead(orderId: number, error: string): Promise<void> {
  await withTransaction(async (tx) => {
    const order = await getOrderForUpdate(tx, orderId)
    if (order?.status === 'picked')
      await transitionInTx(tx, orderId, 'picked', 'payment_issue', SYSTEM, {
        reason: 'capture_failed',
        data: { error },
      })
    await raiseAlert(tx, {
      kind: 'capture.failed',
      dedupeKey: `capture-failed:${orderId}`,
      severity: 'critical',
      message: `Capture failed permanently for order ${order?.publicId ?? orderId}`,
      data: { orderId, error },
    })
  })
}

export async function retryCapture(orderId: number, actor: Actor, reason: string) {
  const order = await getOrder(orderId)
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
  if (order.status !== 'payment_issue')
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      `Only an order with a payment problem can be captured again (this one is ${order.status})`,
    )
  await audit(getDb(), {
    actor,
    action: 'payment.capture_retry',
    targetType: 'order',
    targetId: orderId,
    data: { reason },
  })
  return captureOrder(orderId)
}

export async function voidOrder(
  orderId: number,
  actor: Actor,
  reason: string,
  requestId: string | null = null,
): Promise<Order> {
  const order = await getOrder(orderId)
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found')
  const payment = await getPaymentForOrder(orderId)

  if (order.status === 'pending_payment') {
    if (payment?.checkoutSessionId) {
      const outcome = await getGateway().expireCheckoutSession(payment.checkoutSessionId)
      if (outcome === 'complete')
        throw new HttpError(
          409,
          'ORDER_STATE_CONFLICT',
          'Payment just completed; try again shortly',
        )
    }
    await withTransaction(async (tx) => {
      if (payment) await setPaymentStatus(tx, payment.id, 'expired')
      await transitionInTx(tx, orderId, 'pending_payment', 'abandoned', actor, {
        reason,
        requestId,
      })
    })
    return (await getOrder(orderId))!
  }

  if (!VOIDABLE_STATUSES.includes(order.status))
    throw new HttpError(
      409,
      'ORDER_STATE_CONFLICT',
      `An order that is ${order.status} can't be cancelled`,
    )

  if (payment?.paymentIntentId && payment.status === 'requires_capture')
    await getGateway().cancelPaymentIntent(payment.paymentIntentId, `void:${orderId}`)

  await withTransaction(async (tx) => {
    if (payment && payment.status === 'requires_capture')
      await setPaymentStatus(tx, payment.id, 'canceled')
    await transitionInTx(tx, orderId, order.status, 'cancelled', actor, { reason, requestId })
  })
  return (await getOrder(orderId))!
}

export async function recordAuthorization(
  orderId: number,
  pi: PaymentIntentInfo,
): Promise<'placed' | 'already_placed' | 'voided_stale'> {
  const result = await withTransaction(async (tx) => {
    const order = await getOrderForUpdate(tx, orderId)
    if (!order) throw new Error(`order ${orderId} not found`)
    const payment = await getPaymentForOrder(orderId, tx)
    if (!payment) throw new Error(`order ${orderId} has no payment row`)
    if (order.status === 'pending_payment') {
      await markAuthorized(tx, payment.id, pi)
      await transitionInTx(
        tx,
        orderId,
        'pending_payment',
        'placed',
        { type: 'stripe', id: pi.id },
        {
          data: {
            authorizedCents: pi.amountCapturableCents,
            captureBefore: pi.captureBefore?.toISOString() ?? null,
            overcapture: pi.overcaptureStatus,
            incrementalAuthorization: pi.incrementalAuthorizationStatus,
          },
        },
      )
      if (order.cartId) await markCartConverted(tx, order.cartId)
      return 'placed' as const
    }
    if (order.status === 'abandoned' || order.status === 'cancelled') {
      await recordOrderEvent(tx, orderId, 'late_authorization_voided', {
        type: 'stripe',
        id: pi.id,
      })
      return 'voided_stale' as const
    }
    return 'already_placed' as const
  })
  if (result === 'voided_stale') {
    await getGateway().cancelPaymentIntent(pi.id, `void-stale:${orderId}`)
    await raiseAlert(getDb(), {
      kind: 'payment.late_authorization',
      dedupeKey: `late-auth:${pi.id}`,
      severity: 'warning',
      message: `Authorisation arrived for closed order ${orderId}; voided`,
      data: { orderId, paymentIntentId: pi.id },
    })
  }
  return result
}

export const AUTH_EXPIRY_WARNING_MS = 48 * 3600_000

export async function runAuthExpiryGuard(now: Date = new Date()): Promise<number> {
  const { rows } = await getDb().query<{
    id: string
    order_id: string
    public_id: string
    capture_before: Date
  }>(
    `SELECT p.id, p.order_id, o.public_id, p.capture_before
     FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id
     WHERE p.status = 'requires_capture' AND p.auth_expiry_alerted_at IS NULL
       AND p.capture_before IS NOT NULL AND p.capture_before <= $1`,
    [new Date(now.getTime() + AUTH_EXPIRY_WARNING_MS)],
  )
  for (const r of rows)
    await withTransaction(async (tx) => {
      await raiseAlert(tx, {
        kind: 'payment.auth_expiring',
        dedupeKey: `auth-expiry:${r.id}`,
        severity: 'critical',
        message: `Order ${r.public_id}: card authorisation expires at ${r.capture_before.toISOString()} and is not captured`,
        data: {
          orderId: Number(r.order_id),
          paymentId: Number(r.id),
          captureBefore: r.capture_before,
        },
      })
      await tx.query('UPDATE finance.payments SET auth_expiry_alerted_at = $2 WHERE id = $1', [
        r.id,
        now,
      ])
    })
  return rows.length
}
