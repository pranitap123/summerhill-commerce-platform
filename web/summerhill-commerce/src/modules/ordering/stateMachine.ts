/**
 * Order state machine (G2-09, ORDERS §4). The table below is the single definition of which
 * transitions exist; `transition()` refuses anything else.
 */
export const ORDER_STATUSES = [
  'pending_payment',
  'placed',
  'abandoned',
  'accepted',
  'picking',
  'picked',
  'ready',
  'payment_issue',
  'collected',
  'no_show',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['placed', 'abandoned'],
  placed: ['accepted', 'cancelled'],
  accepted: ['picking', 'cancelled'],
  picking: ['picked', 'cancelled'],
  picked: ['ready', 'payment_issue', 'cancelled'],
  payment_issue: ['ready', 'cancelled'],
  // ready → cancelled: cancel on behalf after capture, with a full refund (G5-04, A7)
  ready: ['collected', 'no_show', 'cancelled'],
  no_show: ['collected', 'cancelled'],
  abandoned: [],
  collected: [],
  cancelled: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** States in which the card is authorised but not captured, so cancelling means a void. */
export const VOIDABLE_STATUSES: readonly OrderStatus[] = [
  'placed',
  'accepted',
  'picking',
  'picked',
  'payment_issue',
]

/** Customer-facing wording for each state. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Waiting for payment',
  placed: 'Order placed',
  abandoned: 'Checkout not completed',
  accepted: 'Accepted by the store',
  picking: 'Being packed',
  picked: 'Packed',
  ready: 'Ready for pickup',
  payment_issue: 'Payment problem',
  collected: 'Picked up',
  no_show: 'Not picked up',
  cancelled: 'Cancelled',
}
