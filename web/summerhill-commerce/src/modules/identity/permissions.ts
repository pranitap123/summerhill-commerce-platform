import type { PlatformRole, SessionUser } from './roles'

/**
 * What each platform role may do (SECURITY §4.1). Permissions are code constants and the map is
 * reviewed like code; `can()` is the single check used by the API gate (`route('admin', …,
 * { permission })`) and the /ops pages. Admin routes that declare no permission are admin-only.
 *
 *  support  read orders, merchants and customers; cancel before capture; refunds ≤ $50 per order;
 *           resolve support issues
 *  finance  refunds of any amount, payouts, reconciliation, disputes, statements, audit log
 *  admin    everything, including users, roles, flags, merchants and the catalogue
 */
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

/** Support refunds up to this much per order (cumulative) without finance/admin (threat T16). */
export const SUPPORT_REFUND_LIMIT_CENTS = 5_000

/** Manual payouts above this need a second person's approval (PAYMENTS §8). */
export const PAYOUT_APPROVAL_THRESHOLD_CENTS = 500_000

export function can(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false
  const allowed: readonly string[] = PERMISSIONS[permission]
  return user.roles.some((r) => allowed.includes(r))
}

/** Every permission a user holds (for menus and the /api/admin/me answer). */
export function permissionsOf(user: SessionUser | null): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user, p))
}
