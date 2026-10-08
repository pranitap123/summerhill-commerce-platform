import type { PlatformRole, SessionUser } from './roles'

export const PERMISSIONS = {
  'ops.enter': ['admin', 'support', 'finance'],
  'orders.read': ['admin', 'support', 'finance'],
  'orders.cancel': ['admin', 'support', 'finance'],
  'refunds.create': ['admin', 'support', 'finance'],
  'refunds.unlimited': ['admin', 'finance'],
  'issues.resolve': ['admin', 'support', 'finance'],
  'merchants.read': ['admin', 'support', 'finance'],
  'merchants.manage': ['admin'],
  'disputes.manage': ['admin', 'finance'],
  'payouts.manage': ['admin', 'finance'],
  'payouts.approve': ['admin', 'finance'],
  'finance.read': ['admin', 'finance'],
  'recon.run': ['admin', 'finance'],
  'metrics.read': ['admin', 'support', 'finance'],
  'audit.read': ['admin', 'finance'],
  'catalog.manage': ['admin'],
  'users.manage': ['admin'],
  'flags.manage': ['admin'],
  'privacy.manage': ['admin'],
} as const satisfies Record<string, readonly PlatformRole[]>

export type Permission = keyof typeof PERMISSIONS

export const SUPPORT_REFUND_LIMIT_CENTS = 5_000

export const PAYOUT_APPROVAL_THRESHOLD_CENTS = 500_000

export function can(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false
  const allowed: readonly string[] = PERMISSIONS[permission]
  return user.roles.some((r) => allowed.includes(r))
}

export function permissionsOf(user: SessionUser | null): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user, p))
}
