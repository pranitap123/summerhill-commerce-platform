import { describe, expect, it } from 'vitest'

import {
  canTransition,
  isTerminal,
  ORDER_STATUSES,
  STATUS_LABELS,
  TRANSITIONS,
  VOIDABLE_STATUSES,
  type OrderStatus,
} from '@/modules/ordering'

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['placed', 'abandoned'],
  placed: ['accepted', 'cancelled'],
  accepted: ['picking', 'cancelled'],
  picking: ['picked', 'cancelled'],
  picked: ['ready', 'payment_issue', 'cancelled'],
  payment_issue: ['ready', 'cancelled'],
  ready: ['collected', 'no_show', 'cancelled'],
  no_show: ['collected', 'cancelled'],
  abandoned: [],
  collected: [],
  cancelled: [],
}

const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const))

describe('order state machine', () => {
  it.each(pairs)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED[from].includes(to))
  })

  it('has no transition table entries beyond the documented ones', () => {
    expect(TRANSITIONS).toEqual(ALLOWED)
  })

  it('terminal states are exactly abandoned, collected and cancelled', () => {
    expect(ORDER_STATUSES.filter(isTerminal).sort()).toEqual([
      'abandoned',
      'cancelled',
      'collected',
    ])
  })

  it('every voidable state can be cancelled and none is captured yet', () => {
    for (const s of VOIDABLE_STATUSES) expect(canTransition(s, 'cancelled')).toBe(true)
    expect(VOIDABLE_STATUSES).not.toContain('ready')
  })

  it('every status has a customer-facing label', () => {
    for (const s of ORDER_STATUSES) expect(STATUS_LABELS[s]).toMatch(/\w/)
  })
})
