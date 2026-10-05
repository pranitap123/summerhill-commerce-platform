import { getDb } from '@/server/db'

export type OnboardingStatus = 'pending' | 'submitted' | 'verified' | 'failed' | 'restricted'

export interface Merchant {
  id: number
  name: string
  stripe_account_id: string | null
  onboarding_status: OnboardingStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  disabled_reason: string | null
  payout_schedule_interval: string
  accepting_orders: boolean
  min_order_cents: number
  weight_buffer_bp: number
  hst_registration_number: string | null
  slug: string
  lifecycle_status: LifecycleStatus
  lifecycle_reason: string | null
  stripe_account_type: 'custom' | 'express' | null
  requirements_due: string[]
  storefront_visible: boolean
  went_live_at: Date | null
  offboarded_at: Date | null
  created_at: Date
}

export type LifecycleStatus = 'draft' | 'live' | 'paused' | 'offboarding' | 'offboarded'

// Explicit column list (never SELECT *). Bigint columns are cast because pg returns them as strings.
const COLUMNS = `id::int AS id, name, stripe_account_id, onboarding_status, charges_enabled,
  payouts_enabled, disabled_reason, payout_schedule_interval, accepting_orders,
  min_order_cents::int AS min_order_cents, weight_buffer_bp, hst_registration_number, slug,
  lifecycle_status, lifecycle_reason, stripe_account_type, requirements_due, storefront_visible,
  went_live_at, offboarded_at, created_at`

export async function getMerchantById(id: number): Promise<Merchant | null> {
  const { rows } = await getDb().query<Merchant>(`SELECT ${COLUMNS} FROM merchants WHERE id = $1`, [
    id,
  ])
  return rows[0] ?? null
}

export async function getMerchantByStripeAccount(accountId: string): Promise<Merchant | null> {
  const { rows } = await getDb().query<Merchant>(
    `SELECT ${COLUMNS} FROM merchant.merchants WHERE stripe_account_id = $1`,
    [accountId],
  )
  return rows[0] ?? null
}

export interface Location {
  id: number
  merchant_id: number
  name: string
  address_line1: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  timezone: string
}

export async function getLocation(id: number): Promise<Location | null> {
  const { rows } = await getDb().query<Location>(
    `SELECT id::int AS id, merchant_id::int AS merchant_id, name, address_line1, city, province,
       postal_code, timezone
     FROM merchant.locations WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function listMerchants(): Promise<Merchant[]> {
  const { rows } = await getDb().query<Merchant>(`SELECT ${COLUMNS} FROM merchants ORDER BY id`)
  return rows
}

export async function updateMerchantStripeAccount(
  id: number,
  stripeAccountId: string,
): Promise<void> {
  await getDb().query(
    'UPDATE merchants SET stripe_account_id = $1, updated_at = now() WHERE id = $2',
    [stripeAccountId, id],
  )
}

/**
 * Columns callers may update through `updateMerchantStatus`. Column names are interpolated into
 * SQL, so they must come from this fixed list and never from input (threat T5, GAP-09).
 */
export const UPDATABLE_STATUS_COLUMNS = [
  'onboarding_status',
  'charges_enabled',
  'payouts_enabled',
  'disabled_reason',
  'payout_schedule_interval',
  'requirements_due',
] as const
type UpdatableColumn = (typeof UPDATABLE_STATUS_COLUMNS)[number]
export type MerchantStatusUpdate = Partial<Pick<Merchant, UpdatableColumn>>

export function buildStatusUpdate(
  id: number,
  fields: MerchantStatusUpdate,
): { text: string; values: unknown[] } | null {
  const keys = Object.keys(fields)
  const unknown = keys.filter((k) => !(UPDATABLE_STATUS_COLUMNS as readonly string[]).includes(k))
  if (unknown.length)
    throw new Error(`updateMerchantStatus: column(s) not allowed: ${unknown.join(', ')}`)
  if (keys.length === 0) return null
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
  return {
    text: `UPDATE merchants SET ${setClause}, updated_at = now() WHERE id = $1`,
    values: [id, ...keys.map((k) => fields[k as UpdatableColumn])],
  }
}

export async function updateMerchantStatus(
  id: number,
  fields: MerchantStatusUpdate,
): Promise<void> {
  const query = buildStatusUpdate(id, fields)
  if (query) await getDb().query(query.text, query.values)
}
