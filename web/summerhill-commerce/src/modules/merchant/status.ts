import type { OnboardingStatus } from './repository'

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
