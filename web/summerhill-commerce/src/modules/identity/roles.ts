export const PLATFORM_ROLES = ['admin', 'support', 'finance'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]
export const ROLES = [...PLATFORM_ROLES, 'customer'] as const
export type Role = (typeof ROLES)[number]

export interface SessionUser {
  id: string | number
  email: string
  roles: Role[]

  defaultReplacementPreference?: 'best_match' | 'refund'

  sessionId?: string | null

  mfaVerified?: boolean
}

export function hasRole(user: SessionUser | null, roles: readonly Role[]): boolean {
  return !!user && user.roles.some((r) => roles.includes(r))
}

export function isPlatformStaff(user: SessionUser | null): boolean {
  return hasRole(user, PLATFORM_ROLES)
}
