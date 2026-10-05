import type { SessionUser } from '@/modules/identity'
import { roleAtLeast, type StaffMembership, type StaffRole } from '@/modules/merchant'
import type { Actor } from '@/modules/ops'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Who may do what in the merchant console (G4-05). A staff member sees only the merchant (and
 * location, when the membership names one) they belong to. Platform admins act as owners
 * everywhere (support), and are recorded as admins in the audit trail.
 *
 * Out-of-scope orders and locations answer 404, not 403, so the console can't be used to probe
 * which order ids exist at other stores (cross-tenant enumeration).
 */
export interface StaffScope {
  user: SessionUser
  memberships: StaffMembership[]
  isAdmin: boolean
}

export function staffScope(user: SessionUser, memberships: StaffMembership[]): StaffScope {
  return { user, memberships, isAdmin: user.roles.includes('admin') }
}

export function staffActor(scope: StaffScope): Actor {
  return scope.isAdmin && !scope.memberships.length
    ? { type: 'admin', id: String(scope.user.id) }
    : { type: 'merchant_staff', id: String(scope.user.id) }
}

/** The caller's role at a location, or null when it's outside their scope. */
export function roleAt(
  scope: StaffScope,
  target: { merchantId: number; locationId: number },
): StaffRole | null {
  let best: StaffRole | null = null
  for (const m of scope.memberships)
    if (
      m.merchantId === target.merchantId &&
      (m.locationId === null || m.locationId === target.locationId) &&
      (!best || roleAtLeast(m.role, best))
    )
      best = m.role
  if (best) return best
  return scope.isAdmin ? 'owner' : null
}

const ROLE_MESSAGES: Record<StaffRole, string> = {
  picker: 'Store staff access required',
  manager: 'A store manager or owner must do this',
  owner: 'Only the store owner can do this',
}

/** Throws 404 outside the caller's scope and 403 when their role is too low; returns the role. */
export function requireRole(
  scope: StaffScope,
  target: { merchantId: number; locationId: number },
  minimum: StaffRole,
  notFound = 'Not found',
): StaffRole {
  const role = roleAt(scope, target)
  if (!role) throw new HttpError(404, 'NOT_FOUND', notFound)
  if (!roleAtLeast(role, minimum)) throw new HttpError(403, 'FORBIDDEN', ROLE_MESSAGES[minimum])
  return role
}

/**
 * Merchant-wide screens (finance, statements: G5-13, M12) are the owner's: an owner membership of
 * that merchant (any location), or a platform admin. Outside the scope → 404.
 */
export function requireMerchantOwner(scope: StaffScope, merchantId: number): void {
  const memberships = scope.memberships.filter((m) => m.merchantId === merchantId)
  if (!memberships.length && !scope.isAdmin) throw new HttpError(404, 'NOT_FOUND', 'Not found')
  if (!scope.isAdmin && !memberships.some((m) => m.role === 'owner'))
    throw new HttpError(403, 'FORBIDDEN', ROLE_MESSAGES.owner)
}

export interface ConsoleLocation {
  locationId: number
  locationName: string
  merchantId: number
  merchantName: string
  timeZone: string
  role: StaffRole
}

/** Locations the caller can open in the console. */
export async function accessibleLocations(scope: StaffScope): Promise<ConsoleLocation[]> {
  const { rows } = await getDb().query(
    `SELECT l.id, l.name, l.merchant_id, m.name AS merchant_name, l.timezone
     FROM merchant.locations l JOIN merchant.merchants m ON m.id = l.merchant_id
     ORDER BY m.name, l.name`,
  )
  return rows.flatMap((r) => {
    const target = { merchantId: Number(r.merchant_id), locationId: Number(r.id) }
    const role = roleAt(scope, target)
    return role
      ? [
          {
            locationId: target.locationId,
            locationName: String(r.name),
            merchantId: target.merchantId,
            merchantName: String(r.merchant_name),
            timeZone: String(r.timezone),
            role,
          },
        ]
      : []
  })
}
