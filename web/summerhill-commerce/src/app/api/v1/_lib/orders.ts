import type { SessionUser } from '@/modules/identity'
import type { Actor } from '@/modules/ops'
import {
  canViewOrder,
  getOrderByPublicId,
  getOrderEvents,
  getOrderLines,
  STATUS_LABELS,
  type Order,
  type OrderLine,
} from '@/modules/ordering'
import { getPaymentForOrder, listRefundsForOrder } from '@/modules/payments'
import { canReportIssue, listIssues } from '@/modules/support'
import { HttpError } from '@/server/http'

export async function viewableOrder(
  publicId: string,
  user: SessionUser | null,
  token: string | null | undefined,
): Promise<Order> {
  const order = await getOrderByPublicId(publicId)
  if (!order || !canViewOrder(order, user, token))
    throw new HttpError(404, 'NOT_FOUND', 'Order not found')
  return order
}

export function customerActor(user: SessionUser | null): Actor {
  return { type: 'customer', id: user ? String(user.id) : null }
}

const CODE_STATUSES = new Set(['placed', 'accepted', 'picking', 'picked', 'ready', 'no_show'])

export async function orderView(order: Order) {
  const [lines, events, payment, refunds, issues] = await Promise.all([
    getOrderLines(order.id),
    getOrderEvents(order.id),
    getPaymentForOrder(order.id),
    listRefundsForOrder(order.id),
    listIssues({ orderId: order.id }),
  ])
  return {
    publicId: order.publicId,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    email: order.email,
    pickupName: order.pickupName,
    currency: order.currency,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    lines: lines.map((l) => lineView(l, lines)),
    pickup: {
      startsAt: order.pickupStartsAt,
      endsAt: order.pickupEndsAt,

      code: CODE_STATUSES.has(order.status) ? order.pickupCode : null,
      arrivedAt: order.arrivedAt,
      collectedAt: order.collectedAt,
    },
    rating:
      order.rating === null
        ? null
        : { rating: order.rating, tags: order.ratingTags, comment: order.ratingComment },
    actions: {
      cancel: order.status === 'placed',
      decideSubstitutions: order.status === 'picking' || order.status === 'accepted',
      checkIn:
        ['accepted', 'picking', 'picked', 'ready', 'no_show'].includes(order.status) &&
        !order.arrivedAt,
      rate: order.status === 'collected',

      reportIssue: canReportIssue(order) && !issues.some((i) => i.status === 'open'),
      reorder: order.status !== 'pending_payment',
    },
    estimate: {
      itemSubtotalCents: order.itemSubtotalCents,
      depositCents: order.depositCents,
      taxCents: order.taxCents,
      totalCents: order.estimatedTotalCents,
      weightBufferCents: order.weightBufferCents,
      authorizationCents: order.authorizationCents,
    },
    final:
      order.finalTotalCents === null
        ? null
        : {
            itemSubtotalCents: order.finalItemSubtotalCents,
            depositCents: order.finalDepositCents,
            taxCents: order.finalTaxCents,
            totalCents: order.finalTotalCents,
            releasedCents: order.authorizationCents - order.finalTotalCents,
          },
    payment: payment
      ? {
          status: payment.status,
          authorizedCents: payment.amountAuthorizedCents,
          capturedCents: payment.amountCapturedCents,
        }
      : null,

    refunds: refunds
      .filter((r) => r.status === 'succeeded')
      .map((r) => ({
        amountCents: r.amountCents,
        at: r.succeededAt,
        lines: r.lines.map((l) => l.lineId),
      })),
    issues: issues.map((i) => ({
      type: i.type,
      status: i.status,
      claimedCents: i.claimedCents,
      note: i.status === 'rejected' ? i.resolutionNote : null,
      createdAt: i.createdAt,
    })),
    timeline: events
      .filter((e) => e.toStatus !== null)
      .map((e) => ({
        status: e.toStatus,
        label: STATUS_LABELS[e.toStatus as Order['status']],
        at: e.at,
      })),
  }
}

function lineView(l: OrderLine, all: OrderLine[]) {
  const original =
    l.substitutesLineId === null ? null : all.find((o) => o.id === l.substitutesLineId)
  return {
    lineId: l.id,
    lineNo: l.lineNo,
    productId: l.productId,
    name: l.name,
    pricingModel: l.pricingModel,
    unit: l.unit,
    quantity: l.quantity,
    estimatedWeightLb: l.estimatedWeightMlb === null ? null : l.estimatedWeightMlb / 1000,
    actualWeightLb: l.actualWeightMlb === null ? null : l.actualWeightMlb / 1000,
    unitPriceCents: l.unitPriceCents,
    regularUnitPriceCents: l.regularUnitPriceCents,
    promoLabel: l.promoLabel,
    taxable: l.taxRateBp > 0,
    lineTotalCents: l.lineTotalCents,
    taxCents: l.taxCents,
    depositCents: l.depositCents,
    status: l.status,
    finalLineTotalCents: l.finalLineTotalCents,
    unavailableReason: l.unavailableReason,

    replaces: original ? { lineNo: original.lineNo, name: original.name } : null,
    customerDecision: l.customerDecision,
    replacementPreference: l.replacementPreference,
  }
}

export type OrderView = Awaited<ReturnType<typeof orderView>>

export function orderSummary(order: Order) {
  return {
    publicId: order.publicId,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    createdAt: order.createdAt,
    totalCents: order.finalTotalCents ?? order.estimatedTotalCents,
    final: order.finalTotalCents !== null,
  }
}
