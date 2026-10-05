import { describe, expect, it } from 'vitest'

import { buildStatusUpdate, deriveOnboardingStatus } from '@/modules/merchant'

describe('buildStatusUpdate (SQL allow-list, GAP-09)', () => {
  it('builds a parameterised update for allowed columns', () => {
    expect(buildStatusUpdate(7, { charges_enabled: true, onboarding_status: 'verified' })).toEqual({
      text: 'UPDATE merchants SET charges_enabled = $2, onboarding_status = $3, updated_at = now() WHERE id = $1',
      values: [7, true, 'verified'],
    })
  })

  it('returns null when there is nothing to update', () => {
    expect(buildStatusUpdate(7, {})).toBeNull()
  })

  it('rejects any column outside the allow-list, including injection attempts', () => {
    expect(() => buildStatusUpdate(7, { name: 'x' } as never)).toThrow(/not allowed/)
    expect(() => buildStatusUpdate(7, { 'id = 1; DROP TABLE merchants; --': 1 } as never)).toThrow(
      /not allowed/,
    )
  })
})

describe('deriveOnboardingStatus', () => {
  it.each([
    [true, null, 'verified'],
    [true, 'rejected.fraud', 'failed'],
    [false, 'rejected.other', 'failed'],
    [false, 'requirements.past_due', 'restricted'],
    [false, null, 'submitted'],
    [true, 'requirements.pending_verification', 'verified'], // charges work; payouts tracked separately
  ])('charges_enabled=%s disabled_reason=%s → %s', (charges, reason, expected) => {
    expect(
      deriveOnboardingStatus({
        charges_enabled: charges,
        requirements: { disabled_reason: reason },
      }),
    ).toBe(expected)
  })
})
