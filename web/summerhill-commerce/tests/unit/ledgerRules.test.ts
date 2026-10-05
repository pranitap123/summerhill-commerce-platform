import { describe, expect, it } from 'vitest'

import { isBalanced, postCapture, postProcessingFee, postRefund } from '@/modules/payments'

describe('ledger posting rules', () => {
  const capture = {
    merchantId: 7,
    capturedCents: 10_000,
    applicationFeeCents: 1130,
    hstOnCommissionCents: 130,
    processingFeeCents: null,
  }

  it('splits HST on commission into its own account and skips an unknown processing fee', () => {
    const entries = postCapture(capture)
    expect(entries.map((e) => [e.account, e.debitCents - e.creditCents])).toEqual([
      ['stripe_clearing', 8870],
      ['merchant_payable:7', -8870],
      ['stripe_clearing', 1000],
      ['platform_fee_revenue', -1000],
      ['stripe_clearing', 130],
      ['hst_on_commission_payable', -130],
      ['merchant_payable:7', 8870],
      ['stripe_clearing', -8870],
    ])
    expect(isBalanced(entries)).toBe(true)
  })

  it('rejects impossible amounts', () => {
    expect(() => postCapture({ ...capture, applicationFeeCents: 10_001 })).toThrow(
      /exceed the captured/,
    )
    expect(() => postCapture({ ...capture, hstOnCommissionCents: 2000 })).toThrow(
      /HST on commission/,
    )
    expect(() => postCapture({ ...capture, capturedCents: 10_000.5 })).toThrow(
      /non-negative integer/,
    )
  })

  it('posts a late processing fee, and nothing for zero', () => {
    expect(postProcessingFee(257)).toEqual([
      { account: 'processing_fee_expense', debitCents: 257, creditCents: 0 },
      { account: 'stripe_clearing', debitCents: 0, creditCents: 257 },
    ])
    expect(postProcessingFee(0)).toEqual([])
  })

  it('refuses a refund whose HST on the fee exceeds the fee refunded', () => {
    expect(() =>
      postRefund({
        merchantId: 7,
        merchantCents: 500,
        platformCents: 0,
        feeRefundCents: 50,
        hstOnFeeRefundCents: 51,
      }),
    ).toThrow('HST on the fee refund cannot exceed the fee refund')
  })

  it('detects an unbalanced set of entries', () => {
    expect(isBalanced([{ account: 'stripe_clearing', debitCents: 1, creditCents: 0 }])).toBe(false)
  })
})
