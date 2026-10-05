import type { OnboardingStatus } from './repository'

/**
 * Derives our onboarding status from a Stripe connected account (DOM-accounttype, ORDERS §8.5).
 * Status depends on charges_enabled + disabled_reason only; payouts_enabled is tracked separately,
 * because an account can take payments while payouts are still blocked on another requirement.
 */
export function deriveOnboardingStatus(account: {
  charges_enabled: boolean
  requirements?: { disabled_reason?: string | null } | null
}): OnboardingStatus {
  const disabledReason = account.requirements?.disabled_reason ?? null
  if (disabledReason?.startsWith('rejected')) return 'failed'
  if (account.charges_enabled) return 'verified'
  if (disabledReason) return 'restricted'
  return 'submitted'
}
