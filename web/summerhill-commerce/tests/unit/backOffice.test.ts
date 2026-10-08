import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  base32Decode,
  can,
  isMfaCookieValid,
  mfaCookieValue,
  otpauthUri,
  PERMISSIONS,
  totp,
  verifyTotp,
  type Permission,
} from '@/modules/identity'
import { hotp } from '@/modules/identity/totp'
import {
  hstShareOfFeeRefund,
  isBalanced,
  lineFullCents,
  lineRefundCents,
  postDispute,
  postDisputeCredit,
  postRefund,
  proportionalFeeRefund,
  reverseEntries,
  splitShares,
  type RefundableLine,
} from '@/modules/payments'
import { businessDayBounds, dueRunDate, matchBalanceTransactions } from '@/modules/payouts'
import { decideIssue } from '@/modules/support'

describe('TOTP (RFC 6238)', () => {
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // secret-scan:allow (RFC 6238 published test key)
  it('decodes the RFC key', () => {
    expect(base32Decode(SECRET).toString('ascii')).toBe('12345678901234567890')
  })
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('T=%i → %s', (seconds, code) => {
    expect(totp(SECRET, new Date(seconds * 1000))).toBe(code)
  })
  it('accepts one step of drift and refuses two', () => {
    const now = new Date(1_700_000_000_000)
    const step = Math.floor(now.getTime() / 30_000)
    expect(verifyTotp(SECRET, hotp(SECRET, step - 1), now)).toBe(step - 1)
    expect(verifyTotp(SECRET, hotp(SECRET, step + 1), now)).toBe(step + 1)
    expect(verifyTotp(SECRET, hotp(SECRET, step - 2), now)).toBeNull()
  })
  it('refuses a replayed code (a step at or before the last used one)', () => {
    const now = new Date(1_700_000_000_000)
    const code = totp(SECRET, now)
    const step = verifyTotp(SECRET, code, now)!
    expect(verifyTotp(SECRET, code, now, step)).toBeNull()
  })
  it('refuses malformed codes', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456'])
      expect(verifyTotp(SECRET, bad)).toBeNull()
  })
  it('builds the key URI authenticator apps import', () => {
    const uri = otpauthUri(SECRET, 'ops@example.com', 'Grocery Demo')
    expect(uri).toMatch(/^otpauth:\/\/totp\/Grocery%20Demo%3Aops%40example\.com\?/)
    expect(new URL(uri).searchParams.get('secret')).toBe(SECRET)
  })
})

describe('MFA session cookie', () => {
  const now = new Date('2026-09-28T12:00:00Z')
  it('is bound to the user and the session, and expires', () => {
    const { value } = mfaCookieValue('42', 'sid-1', now)
    expect(isMfaCookieValid(value, '42', 'sid-1', now)).toBe(true)
    expect(isMfaCookieValid(value, '43', 'sid-1', now)).toBe(false)
    expect(isMfaCookieValid(value, '42', 'sid-2', now)).toBe(false)
    expect(isMfaCookieValid(value, '42', null, now)).toBe(false)
    expect(isMfaCookieValid(value, '42', 'sid-1', new Date(now.getTime() + 8 * 3600_000 + 1))).toBe(
      false,
    )
  })
  it('rejects a tampered value', () => {
    const { value } = mfaCookieValue('42', 'sid-1', now)
    expect(isMfaCookieValid(value.replace('42~', '1~'), '1', 'sid-1', now)).toBe(false)
  })
})

describe('platform role permissions', () => {
  const as = (role: string) => ({ id: 1, email: 'x@example.com', roles: [role] as never })
  it.each<[string, Permission, boolean]>([
    ['support', 'orders.read', true],
    ['support', 'orders.cancel', true],
    ['support', 'refunds.create', true],
    ['support', 'refunds.unlimited', false],
    ['support', 'payouts.manage', false],
    ['support', 'merchants.manage', false],
    ['support', 'flags.manage', false],
    ['finance', 'refunds.unlimited', true],
    ['finance', 'payouts.approve', true],
    ['finance', 'recon.run', true],
    ['finance', 'disputes.manage', true],
    ['finance', 'users.manage', false],
    ['customer', 'ops.enter', false],
  ])('%s → %s: %s', (role, permission, expected) => {
    expect(can(as(role), permission)).toBe(expected)
  })
  it('admin holds every permission', () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can(as('admin'), p)).toBe(true)
  })
})

const line = (over: Partial<RefundableLine> = {}): RefundableLine => ({
  id: 1,
  isWeighed: false,
  finalLineTotalCents: 998,
  finalTaxCents: 130,
  finalDepositCents: 20,
  paidUnits: 2,
  paidWeightMlb: null,
  ...over,
})

describe('refund amounts (PAYMENTS §6)', () => {
  it('a whole line is its total + HST + deposit', () => {
    expect(lineFullCents(line())).toBe(1148)
    expect(lineRefundCents(line())).toBe(1148)
  })
  it('part of a line is pro rata by count', () => {
    expect(lineRefundCents(line(), { quantity: 1 })).toBe(574)
  })
  it('part of a weighed line is pro rata by weight', () => {
    const steak = line({
      isWeighed: true,
      finalLineTotalCents: 5830,
      finalTaxCents: 0,
      finalDepositCents: 0,
      paidUnits: 1,
      paidWeightMlb: 1620,
    })
    expect(lineRefundCents(steak, { weightMlb: 810 })).toBe(2915)
  })
  it('refuses more than was paid for', () => {
    expect(() => lineRefundCents(line(), { quantity: 3 })).toThrow(RangeError)
    expect(() => lineRefundCents(line(), { weightMlb: 100 })).toThrow(RangeError)
    const weighed = line({ isWeighed: true, paidUnits: 1, paidWeightMlb: 1620 })
    expect(() => lineRefundCents(weighed, { weightMlb: 0 })).toThrow(/more than 0/)
    expect(() => lineRefundCents(weighed, { weightMlb: 1621 })).toThrow(/at most the weight/)
  })
  it('parts never add up to more than the line', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 0, max: 100_000 }),
        (units, total) => {
          const l = line({ paidUnits: units, finalLineTotalCents: total })
          const parts = Array.from({ length: units }, () => lineRefundCents(l, { quantity: 1 }))
          const sum = parts.reduce((a, b) => a + b, 0)
          expect(Math.abs(sum - lineFullCents(l))).toBeLessThanOrEqual(units)
        },
      ),
    )
  })
  it('splits liability', () => {
    expect(splitShares('merchant', 1000)).toEqual({ merchantCents: 1000, platformCents: 0 })
    expect(splitShares('platform', 1000)).toEqual({ merchantCents: 0, platformCents: 1000 })
    expect(splitShares('split', 1001)).toEqual({ merchantCents: 501, platformCents: 500 })
    expect(splitShares('split', 1000, 300)).toEqual({ merchantCents: 300, platformCents: 700 })
    expect(() => splitShares('split', 1000, 1000)).toThrow(RangeError)
  })
  it('HST on the fee refund keeps the capture proportion', () => {
    expect(hstShareOfFeeRefund(113, 1130, 130)).toBe(13)
    expect(hstShareOfFeeRefund(100, 1000, 0)).toBe(0)
    expect(hstShareOfFeeRefund(5, 0, 0)).toBe(0)
  })
  it("cumulative fee refunds follow Stripe's proportional rule and never exceed the fee", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 }),
        (captured, parts) => {
          const fee = Math.floor(captured * 0.2)
          let reversed = 0
          let total = 0
          for (const p of parts) {
            reversed = Math.min(captured, reversed + p)
            const next = proportionalFeeRefund(fee, captured, reversed)
            expect(next).toBeGreaterThanOrEqual(total)
            total = next
          }
          expect(total).toBeLessThanOrEqual(fee)
          if (reversed === captured) expect(total).toBe(fee)
        },
      ),
    )
  })
})

describe('refund and dispute ledger rules (PAYMENTS §9)', () => {
  it('every refund journal balances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (m, p, f) => {
          const h = Math.floor(f * 0.1)
          const entries = postRefund({
            merchantId: 1,
            merchantCents: m,
            platformCents: p,
            feeRefundCents: f,
            hstOnFeeRefundCents: h,
          })
          expect(isBalanced(entries)).toBe(true)
          expect(isBalanced(reverseEntries(entries))).toBe(true)
        },
      ),
    )
  })
  it('the platform clearing account moves by what the platform actually pays', () => {
    const entries = postRefund({
      merchantId: 1,
      merchantCents: 500,
      platformCents: 300,
      feeRefundCents: 75,
      hstOnFeeRefundCents: 0,
    })
    const clearing = entries
      .filter((e) => e.account === 'stripe_clearing')
      .reduce((s, e) => s + e.debitCents - e.creditCents, 0)
    expect(clearing).toBe(-375)
  })
  it('a dispute debits amount + fee; recoveries credit it back', () => {
    expect(postDispute({ amountCents: 2000, feeCents: 1500 })).toEqual([
      { account: 'dispute_expense', debitCents: 3500, creditCents: 0 },
      { account: 'stripe_clearing', debitCents: 0, creditCents: 3500 },
    ])
    expect(isBalanced(postDisputeCredit(2000))).toBe(true)
  })
})

describe('support auto-approval policy (ORDERS §10)', () => {
  const config = { maxIssueCents: 1500, max90DayCents: 3000 }
  const base = {
    type: 'missing' as const,
    claimedCents: 1000,
    customer90DayRefundCents: 0,
    autoRefundEnabled: true,
  }
  it('small first claims are refunded automatically', () => {
    expect(decideIssue(base, config).decision).toBe('auto_approve')
    expect(decideIssue({ ...base, claimedCents: 1500 }, config).decision).toBe('auto_approve')
  })
  it.each([
    ['over the per-issue limit', { claimedCents: 1501 }],
    ['over the 90-day limit', { customer90DayRefundCents: 2500 }],
    ['switched off', { autoRefundEnabled: false }],
    ['type other', { type: 'other' as const }],
    ['nothing to refund', { claimedCents: 0 }],
  ])('queues when %s', (_, over) => {
    const d = decideIssue({ ...base, ...over }, config)
    expect(d.decision).toBe('queue')
    expect(d.reasons.length).toBeGreaterThan(0)
  })
})

describe('reconciliation matching (PAYMENTS §10)', () => {
  const t = (type: string, sourceId: string, amountCents: number, feeCents = 0) => ({
    id: `txn_${sourceId}`,
    type,
    sourceId,
    amountCents,
    feeCents,
    created: new Date(),
  })
  const ours = {
    payments: [
      { orderId: 1, chargeId: 'ch_1', capturedCents: 7821, processingFeeCents: 257 },
      { orderId: 2, chargeId: 'ch_2', capturedCents: 1000, processingFeeCents: null },
      { orderId: 3, chargeId: 'ch_3', capturedCents: 500, processingFeeCents: 45 },
    ],
    refunds: [
      { orderId: 1, stripeRefundId: 're_1', amountCents: 499, expectRefund: true, failed: false },
      { orderId: 3, stripeRefundId: 're_2', amountCents: 100, expectRefund: false, failed: true },
    ],
    disputes: [
      {
        orderId: 2,
        stripeDisputeId: 'dp_1',
        amountCents: 1000,
        feeCents: 1500,
        reinstatedCents: 1000,
      },
    ],
    knownReversals: new Set(['trr_1']),
  }
  it('matches to the cent and posts a Stripe fee learned late', () => {
    const r = matchBalanceTransactions(
      [
        t('charge', 'ch_1', 7821, 257),
        t('charge', 'ch_2', 1000, 59),
        t('charge', 'ch_3', 500, 45),
        t('refund', 're_1', -499),
        t('adjustment', 'dp_1', -1000, 1500),
        t('adjustment', 'dp_1', 1000), // won: funds reinstated
        t('refund_failure', 're_2', 100),
        t('transfer_refund', 'trr_1', 499),
        t('transfer', 'tr_1', -7821),
        t('application_fee', 'fee_1', 1163),
      ],
      ours,
    )
    expect(r.items).toEqual([])
    expect(r.matched).toBe(7)
    expect(r.informational).toBe(3)
    expect(r.feesToPost).toEqual([{ orderId: 2, feeCents: 59 }])
  })
  it('reports amount differences, unknown Stripe objects and missing ones', () => {
    const r = matchBalanceTransactions(
      [
        t('charge', 'ch_1', 7822, 257),
        t('refund', 're_9', -100),
        t('adjustment', 'dp_9', -50, 1500),
        t('transfer_refund', 'trr_9', 10),
      ],
      ours,
    )
    const kinds = r.items.map((i) => `${i.kind}:${i.checkName}`).sort()
    expect(kinds).toEqual([
      'amount_mismatch:charge_amount',
      'missing_in_stripe:charge',
      'missing_in_stripe:charge',
      'missing_in_stripe:refund',
      'unmatched_stripe:dispute',
      'unmatched_stripe:refund',
      'unmatched_stripe:transfer_reversal',
    ])
    expect(r.items.find((i) => i.checkName === 'charge_amount')).toMatchObject({
      expected: 7821,
      actual: 7822,
    })
  })
  it('business days follow Toronto, including the DST change', () => {
    const { from, to } = businessDayBounds('2026-11-01')
    expect(from.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(to.getTime() - from.getTime()).toBe(25 * 3600_000)
  })
  it('the daily run is due after 06:00 Toronto, for the previous day', () => {
    expect(dueRunDate(new Date('2026-09-28T09:59:00Z'))).toBeNull()
    expect(dueRunDate(new Date('2026-09-28T10:00:00Z'))).toBe('2026-09-27')
  })
})
