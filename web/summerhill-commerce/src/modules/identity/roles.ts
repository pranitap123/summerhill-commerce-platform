// Pure role logic, kept apart from auth.ts so it can be used (and tested) without loading Payload.
/**
 * Platform roles (SECURITY §4.1): `admin` is the platform admin; `support` and `finance` are the
 * back-office roles added in G5. Merchant staff roles are memberships (merchant module), not
 * account roles. Customers have `customer`.
 */
export const PLATFORM_ROLES = ['admin', 'support', 'finance'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]
export const ROLES = [...PLATFORM_ROLES, 'customer'] as const
export type Role = (typeof ROLES)[number]

export interface SessionUser {
  id: string | number
  email: string
  roles: Role[]
  /** Customer setting (G2-20): default for new cart lines. */
  defaultReplacementPreference?: 'best_match' | 'refund'
  /** Payload session id (sid claim); the MFA cookie is bound to it (G5-12). */
  sessionId?: string | null
  /** A second factor was verified for this session (G5-12). */
  mfaVerified?: boolean
}

export function hasRole(user: SessionUser | null, roles: readonly Role[]): boolean {
  return !!user && user.roles.some((r) => roles.includes(r))
}

export function isPlatformStaff(user: SessionUser | null): boolean {
  return hasRole(user, PLATFORM_ROLES)
}
