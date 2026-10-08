import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { getMerchantById, type LifecycleStatus, type Merchant } from './repository'

export const OPEN_ORDER_STATUSES = [
  'placed',
  'accepted',
  'picking',
  'picked',
  'payment_issue',
  'ready',
  'no_show',
] as const

export interface GoLiveCheck {
  chargesEnabled: boolean
  publishedProducts: number
  ok: boolean
  blockers: string[]
}

export async function goLiveCheck(merchant: Merchant, db: Db = getDb()): Promise<GoLiveCheck> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM catalog.products
     WHERE merchant_id = $1 AND deleted_at IS NULL AND source_status = 'listed' AND blocked_reason IS NULL`,
    [merchant.id],
  )
  const publishedProducts = rows[0].n
  const blockers = [
    ...(merchant.charges_enabled ? [] : ['Stripe charges are not enabled (finish onboarding)']),
    ...(publishedProducts > 0 ? [] : ['No published catalogue (run and approve an ingest first)']),
  ]
  return {
    chargesEnabled: merchant.charges_enabled,
    publishedProducts,
    ok: !blockers.length,
    blockers,
  }
}

export async function openOrderCount(merchantId: number, db: Db = getDb()): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM commerce.orders WHERE merchant_id = $1 AND status = ANY($2::text[])`,
    [merchantId, OPEN_ORDER_STATUSES],
  )
  return rows[0].n
}

const TRANSITIONS: Record<string, { from: LifecycleStatus[]; to: LifecycleStatus }> = {
  go_live: { from: ['draft', 'paused'], to: 'live' },
  pause: { from: ['live'], to: 'paused' },
  resume: { from: ['paused'], to: 'live' },
  offboard: { from: ['draft', 'live', 'paused'], to: 'offboarding' },
}
export type LifecycleAction = keyof typeof TRANSITIONS | 'finish_offboarding'

export async function changeLifecycle(
  merchantId: number,
  action: keyof typeof TRANSITIONS,
  reason: string | null,
): Promise<{ before: Merchant; after: Merchant }> {
  const before = await getMerchantById(merchantId)
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  const t = TRANSITIONS[action]
  if (!t.from.includes(before.lifecycle_status))
    throw new HttpError(
      409,
      'LIFECYCLE_CONFLICT',
      `A ${before.lifecycle_status} merchant can't ${action.replace('_', ' ')}`,
    )
  if (t.to === 'live') {
    const check = await goLiveCheck(before)
    if (!check.ok)
      throw new HttpError(422, 'GO_LIVE_BLOCKED', check.blockers.join('; '), {
        blockers: check.blockers,
      })
  }
  const live = t.to === 'live'
  await getDb().query(
    `UPDATE merchant.merchants SET lifecycle_status = $2, lifecycle_reason = $3,
       accepting_orders = $4, storefront_visible = $5,
       went_live_at = CASE WHEN $2 = 'live' THEN COALESCE(went_live_at, now()) ELSE went_live_at END
     WHERE id = $1`,
    [merchantId, t.to, reason, live, t.to === 'live' || t.to === 'paused'],
  )
  return { before, after: (await getMerchantById(merchantId))! }
}

export async function markOffboarded(merchantId: number, db: Db = getDb()): Promise<void> {
  await db.query(
    `UPDATE merchant.merchants SET lifecycle_status = 'offboarded', offboarded_at = now(),
       accepting_orders = false, storefront_visible = false
     WHERE id = $1 AND lifecycle_status = 'offboarding'`,
    [merchantId],
  )
}

export async function createMerchant(input: {
  slug: string
  name: string
  hstRegistrationNumber: string | null
  location: {
    slug: string
    name: string
    addressLine1: string | null
    city: string | null
    province: string | null
    postalCode: string | null
  }
}): Promise<Merchant> {
  const id = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO merchant.merchants (slug, name, hst_registration_number, lifecycle_status,
         accepting_orders, storefront_visible)
       VALUES ($1, $2, $3, 'draft', false, false)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [input.slug, input.name, input.hstRegistrationNumber],
    )
    if (!rows[0]) throw new HttpError(409, 'SLUG_TAKEN', 'A merchant with this slug already exists')
    const l = await tx.query<{ id: string }>(
      `INSERT INTO merchant.locations (merchant_id, slug, name, address_line1, city, province, postal_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        rows[0].id,
        input.location.slug,
        input.location.name,
        input.location.addressLine1,
        input.location.city,
        input.location.province,
        input.location.postalCode,
      ],
    )
    await tx.query('INSERT INTO merchant.location_settings (location_id) VALUES ($1)', [
      l.rows[0].id,
    ])
    return Number(rows[0].id)
  })
  return (await getMerchantById(id))!
}

export async function setStripeAccount(
  merchantId: number,
  accountId: string,
  type: 'custom' | 'express',
): Promise<void> {
  await getDb().query(
    `UPDATE merchant.merchants SET stripe_account_id = $2, stripe_account_type = $3,
       onboarding_status = CASE WHEN onboarding_status = 'pending' THEN 'submitted' ELSE onboarding_status END
     WHERE id = $1 AND (stripe_account_id IS NULL OR stripe_account_id = $2)`,
    [merchantId, accountId, type],
  )
}

export interface MerchantHealth {
  goLive: GoLiveCheck
  openOrders: number
  last30Days: {
    orders: number
    autoRejected: number
    storeRejected: number
    medianAcceptSeconds: number | null
    medianReadySeconds: number | null
  }
  lastIngest: { id: number; status: string; startedAt: Date } | null
}

export async function merchantHealth(merchant: Merchant): Promise<MerchantHealth> {
  const db = getDb()
  const [goLive, openOrders, stats, ingest] = await Promise.all([
    goLiveCheck(merchant),
    openOrderCount(merchant.id),
    db.query(
      `SELECT count(*)::int AS orders,
         count(*) FILTER (WHERE e.reason = 'auto_rejected')::int AS auto_rejected,
         count(*) FILTER (WHERE e.actor_type = 'merchant_staff')::int AS store_rejected,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM o.accepted_at - o.placed_at))
           FILTER (WHERE o.accepted_at IS NOT NULL) AS median_accept,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.at - o.placed_at))
           FILTER (WHERE r.at IS NOT NULL) AS median_ready
       FROM commerce.orders o
       LEFT JOIN LATERAL (SELECT reason, actor_type FROM commerce.order_events
         WHERE order_id = o.id AND to_status = 'cancelled' AND from_status = 'placed' LIMIT 1) e ON true
       LEFT JOIN LATERAL (SELECT at FROM commerce.order_events
         WHERE order_id = o.id AND to_status = 'ready' LIMIT 1) r ON true
       WHERE o.merchant_id = $1 AND o.placed_at > now() - interval '30 days'`,
      [merchant.id],
    ),
    db.query(
      `SELECT id, status, started_at FROM ops.ingest_runs WHERE merchant_id = $1 ORDER BY id DESC LIMIT 1`,
      [merchant.id],
    ),
  ])
  const s = stats.rows[0]
  const round = (v: unknown) => (v === null ? null : Math.round(Number(v)))
  return {
    goLive,
    openOrders,
    last30Days: {
      orders: s.orders,
      autoRejected: s.auto_rejected,
      storeRejected: s.store_rejected,
      medianAcceptSeconds: round(s.median_accept),
      medianReadySeconds: round(s.median_ready),
    },
    lastIngest: ingest.rows[0]
      ? {
          id: Number(ingest.rows[0].id),
          status: ingest.rows[0].status,
          startedAt: ingest.rows[0].started_at,
        }
      : null,
  }
}
