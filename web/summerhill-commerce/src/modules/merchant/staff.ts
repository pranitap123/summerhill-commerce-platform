import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

/**
 * Merchant staff (G4-05). A Payload user becomes staff through a membership row that scopes them
 * to one merchant and optionally one location (NULL = every location of that merchant).
 * Roles are ordered: owner ⊃ manager ⊃ picker.
 */
export const STAFF_ROLES = ['picker', 'manager', 'owner'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export interface StaffMembership {
  id: number
  userId: string
  merchantId: number
  merchantName: string
  locationId: number | null
  role: StaffRole
}

/** True when `role` is at least `minimum` (owner ≥ manager ≥ picker). */
export function roleAtLeast(role: StaffRole, minimum: StaffRole): boolean {
  return STAFF_ROLES.indexOf(role) >= STAFF_ROLES.indexOf(minimum)
}

export async function listStaffMemberships(
  userId: string,
  db: Db = getDb(),
): Promise<StaffMembership[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.merchant_id, m.name AS merchant_name, s.location_id, s.role
     FROM merchant.staff_memberships s JOIN merchant.merchants m ON m.id = s.merchant_id
     WHERE s.user_id = $1 AND s.active ORDER BY s.merchant_id`,
    [userId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    userId: String(r.user_id),
    merchantId: Number(r.merchant_id),
    merchantName: String(r.merchant_name),
    locationId: r.location_id === null ? null : Number(r.location_id),
    role: r.role as StaffRole,
  }))
}

/** Creates or updates a membership (demo seed, and G5-15's user management later). */
export async function upsertStaffMembership(
  db: Db,
  m: { userId: string; merchantId: number; locationId: number | null; role: StaffRole },
): Promise<void> {
  await db.query(
    `INSERT INTO merchant.staff_memberships (user_id, merchant_id, location_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, merchant_id) DO UPDATE
       SET location_id = EXCLUDED.location_id, role = EXCLUDED.role, active = true`,
    [m.userId, m.merchantId, m.locationId, m.role],
  )
}

export interface StaffMembershipRow extends StaffMembership {
  active: boolean
  locationName: string | null
}

/** Every membership, active or not, for the user management page (G5-15). */
export async function listAllStaffMemberships(db: Db = getDb()): Promise<StaffMembershipRow[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.merchant_id, m.name AS merchant_name, s.location_id,
       l.name AS location_name, s.role, s.active
     FROM merchant.staff_memberships s JOIN merchant.merchants m ON m.id = s.merchant_id
     LEFT JOIN merchant.locations l ON l.id = s.location_id
     ORDER BY s.user_id, s.merchant_id`,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    userId: String(r.user_id),
    merchantId: Number(r.merchant_id),
    merchantName: String(r.merchant_name),
    locationId: r.location_id === null ? null : Number(r.location_id),
    locationName: r.location_name === null ? null : String(r.location_name),
    role: r.role as StaffRole,
    active: Boolean(r.active),
  }))
}

/** Deactivates one membership (merchantId given) or all of a user's memberships. */
export async function deactivateStaffMemberships(
  db: Db,
  userId: string,
  merchantId?: number,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE merchant.staff_memberships SET active = false
     WHERE user_id = $1 AND active AND ($2::bigint IS NULL OR merchant_id = $2)`,
    [userId, merchantId ?? null],
  )
  return rowCount ?? 0
}
