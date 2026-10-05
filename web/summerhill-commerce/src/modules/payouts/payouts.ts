import type Stripe from 'stripe'

import { PAYOUT_APPROVAL_THRESHOLD_CENTS } from '@/modules/identity'
import {
  getMerchantById,
  getMerchantByStripeAccount,
  markOffboarded,
  openOrderCount,
} from '@/modules/merchant'
import { audit, raiseAlert, type AuditContext } from '@/modules/ops'
import { getGateway } from '@/modules/payments'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Merchant payouts (G5-07, PAYMENTS §8). Automatic payouts follow the Stripe schedule and show up
 * here through `payout.*` Connect webhooks. A manual payout needs an available balance, an
 * Idempotency-Key (at the API) and a reason; above $5,000 it waits for a SECOND person's approval
 * (four eyes: the database refuses approved_by = requested_by). Failures alert ops and show in the
 * merchant console.
 */
export interface Payout {
  id: number
  merchantId: number
  merchantName: string
  stripePayoutId: string | null
  method: 'manual' | 'automatic'
  amountCents: number
  status: string
  reason: string | null
  requestedBy: string | null
  approvedBy: string | null
  approvedAt: Date | null
  arrivalDate: string | null
  failureCode: string | null
  failureMessage: string | null
  createdAt: Date
}

type Row = Record<string, unknown>
function toPayout(r: Row): Payout {
  return {
    id: Number(r.id),
    merchantId: Number(r.merchant_id),
    merchantName: String(r.merchant_name),
    stripePayoutId: (r.stripe_payout_id as string) ?? null,
    method: r.method as Payout['method'],
    amountCents: Number(r.amount_cents),
    status: String(r.status),
    reason: (r.reason as string) ?? null,
    requestedBy: (r.requested_by as string) ?? null,
    approvedBy: (r.approved_by as string) ?? null,
    approvedAt: (r.approved_at as Date) ?? null,
    arrivalDate: r.arrival_date ? String(r.arrival_date).slice(0, 10) : null,
    failureCode: (r.failure_code as string) ?? null,
    failureMessage: (r.failure_message as string) ?? null,
    createdAt: r.created_at as Date,
  }
}

const SELECT = `SELECT p.*, p.arrival_date::text AS arrival_date, m.name AS merchant_name
  FROM finance.payouts p JOIN merchant.merchants m ON m.id = p.merchant_id`

export async function getPayout(id: number, db: Db = getDb()): Promise<Payout | null> {
  const { rows } = await db.query(`${SELECT} WHERE p.id = $1`, [id])
  return rows[0] ? toPayout(rows[0]) : null
}

export async function listPayouts(
  filter: { merchantId?: number; status?: string; limit?: number } = {},
): Promise<Payout[]> {
  const { rows } = await getDb().query(
    `${SELECT} WHERE ($1::bigint IS NULL OR p.merchant_id = $1) AND ($2::text IS NULL OR p.status = $2)
     ORDER BY p.id DESC LIMIT $3`,
    [filter.merchantId ?? null, filter.status ?? null, filter.limit ?? 100],
  )
  return rows.map(toPayout)
}

async function merchantAccount(merchantId: number) {
  const merchant = await getMerchantById(merchantId)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  if (!merchant.stripe_account_id)
    throw new HttpError(409, 'NO_STRIPE_ACCOUNT', 'Merchant has no Stripe account')
  return { merchant, accountId: merchant.stripe_account_id }
}

export async function merchantBalance(merchantId: number) {
  const { accountId } = await merchantAccount(merchantId)
  return getGateway().retrieveBalance(accountId)
}

/** Requests a manual payout; executes it at once when no approval is needed. */
export async function requestPayout(
  ctx: AuditContext,
  input: { merchantId: number; amountCents: number; reason: string },
): Promise<Payout> {
  const { merchant, accountId } = await merchantAccount(input.merchantId)
  if (!merchant.payouts_enabled)
    throw new HttpError(409, 'PAYOUTS_BLOCKED', 'Payouts are not enabled for this merchant', {
      reason: merchant.disabled_reason ?? 'payouts_disabled',
    })
  const balance = await getGateway().retrieveBalance(accountId)
  if (input.amountCents > balance.availableCents)
    throw new HttpError(
      422,
      'INSUFFICIENT_BALANCE',
      'The amount is more than the available balance',
      {
        availableCents: balance.availableCents,
      },
    )
  const needsApproval = input.amountCents > PAYOUT_APPROVAL_THRESHOLD_CENTS
  const id = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO finance.payouts (merchant_id, method, amount_cents, status, reason, requested_by)
       VALUES ($1, 'manual', $2, $3, $4, $5) RETURNING id`,
      [
        input.merchantId,
        input.amountCents,
        needsApproval ? 'pending_approval' : 'requested',
        input.reason,
        ctx.actor.id,
      ],
    )
    await audit(tx, {
      ...ctx,
      action: 'payout.request',
      targetType: 'merchant',
      targetId: input.merchantId,
      data: {
        payoutId: Number(rows[0].id),
        amountCents: input.amountCents,
        availableCents: balance.availableCents,
        needsApproval,
        reason: input.reason,
      },
    })
    return Number(rows[0].id)
  })
  if (needsApproval) return (await getPayout(id))!
  return executePayout(id, accountId)
}

/** Second person approves a payout above the threshold (never their own). */
export async function approvePayout(
  ctx: AuditContext,
  payoutId: number,
  decision: 'approve' | 'reject',
): Promise<Payout> {
  const payout = await getPayout(payoutId)
  if (!payout) throw new HttpError(404, 'NOT_FOUND', 'Payout not found')
  if (payout.status !== 'pending_approval')
    throw new HttpError(409, 'PAYOUT_NOT_PENDING', `This payout is ${payout.status}`)
  if (payout.requestedBy === ctx.actor.id)
    throw new HttpError(
      403,
      'SELF_APPROVAL',
      'A payout must be approved by someone other than the requester',
    )
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE finance.payouts SET status = $2, approved_by = $3, approved_at = now()
       WHERE id = $1 AND status = 'pending_approval'`,
      [payoutId, decision === 'approve' ? 'requested' : 'rejected', ctx.actor.id],
    )
    if (!rowCount) throw new HttpError(409, 'PAYOUT_NOT_PENDING', 'This payout was already decided')
    await audit(tx, {
      ...ctx,
      action: decision === 'approve' ? 'payout.approve' : 'payout.reject',
      targetType: 'payout',
      targetId: payoutId,
      data: { amountCents: payout.amountCents, requestedBy: payout.requestedBy },
    })
  })
  if (decision === 'reject') return (await getPayout(payoutId))!
  const { accountId } = await merchantAccount(payout.merchantId)
  return executePayout(payoutId, accountId)
}

async function executePayout(payoutId: number, accountId: string): Promise<Payout> {
  const payout = (await getPayout(payoutId))!
  try {
    const result = await getGateway().createPayout(
      accountId,
      payout.amountCents,
      { payout_id: String(payoutId), merchant_id: String(payout.merchantId) },
      `payout:${payoutId}`,
    )
    // The webhook may already have recorded this Stripe payout (simulator events are immediate).
    await getDb().query(
      `UPDATE finance.payouts SET stripe_payout_id = $2,
         status = CASE WHEN status = 'requested' THEN $3 ELSE status END,
         arrival_date = COALESCE(arrival_date, $4::date) WHERE id = $1`,
      [payoutId, result.id, result.status, result.arrivalDate],
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await getDb().query(
      `UPDATE finance.payouts SET status = 'failed', failure_message = $2 WHERE id = $1`,
      [payoutId, message.slice(0, 500)],
    )
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider refused the payout', {
      message,
    })
  }
  await finishOffboardingIfDone(payout.merchantId)
  return (await getPayout(payoutId))!
}

/** payout.* Connect webhooks: automatic payouts appear, manual ones get their final status. */
export async function onPayoutEvent(
  account: string | null,
  p: Pick<Stripe.Payout, 'id' | 'amount' | 'status' | 'arrival_date' | 'metadata' | 'automatic'> & {
    failure_code?: string | null
    failure_message?: string | null
  },
): Promise<'processed' | 'ignored'> {
  const merchant = account ? await getMerchantByStripeAccount(account) : null
  if (!merchant) return 'ignored'
  const ourId = Number(p.metadata?.payout_id)
  const status = ['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(p.status)
    ? p.status
    : 'pending'
  const arrival = p.arrival_date ? new Date(p.arrival_date * 1000) : null
  await withTransaction(async (tx) => {
    const matched =
      Number.isSafeInteger(ourId) && ourId > 0
        ? await tx.query(
            `UPDATE finance.payouts SET stripe_payout_id = $2, status = $3,
             arrival_date = COALESCE($4::date, arrival_date), failure_code = $5, failure_message = $6
           WHERE id = $1 AND merchant_id = $7 RETURNING id`,
            [
              ourId,
              p.id,
              status,
              arrival,
              p.failure_code ?? null,
              p.failure_message ?? null,
              merchant.id,
            ],
          )
        : { rowCount: 0 }
    if (!matched.rowCount)
      await tx.query(
        `INSERT INTO finance.payouts (merchant_id, stripe_payout_id, method, amount_cents, status,
           arrival_date, failure_code, failure_message)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
         ON CONFLICT (stripe_payout_id) DO UPDATE SET status = EXCLUDED.status,
           arrival_date = EXCLUDED.arrival_date, failure_code = EXCLUDED.failure_code,
           failure_message = EXCLUDED.failure_message`,
        [
          merchant.id,
          p.id,
          p.automatic ? 'automatic' : 'manual',
          p.amount,
          status,
          arrival,
          p.failure_code ?? null,
          p.failure_message ?? null,
        ],
      )
    if (status === 'failed')
      await raiseAlert(tx, {
        kind: 'payout.failed',
        dedupeKey: `payout-failed:${p.id}`,
        severity: 'critical',
        message: `Payout ${p.id} to ${merchant.name} failed: ${p.failure_message ?? p.failure_code ?? 'unknown'}`,
        data: { merchantId: merchant.id, payoutId: p.id, failureCode: p.failure_code ?? null },
      })
  })
  return 'processed'
}

export async function setPayoutSchedule(
  ctx: AuditContext,
  merchantId: number,
  interval: 'manual' | 'daily' | 'weekly' | 'monthly',
): Promise<void> {
  const { merchant, accountId } = await merchantAccount(merchantId)
  await getGateway().updatePayoutSchedule(accountId, interval)
  await withTransaction(async (tx) => {
    await tx.query('UPDATE merchant.merchants SET payout_schedule_interval = $2 WHERE id = $1', [
      merchantId,
      interval,
    ])
    await audit(tx, {
      ...ctx,
      action: 'payout.schedule',
      targetType: 'merchant',
      targetId: merchantId,
      data: { before: merchant.payout_schedule_interval, after: interval },
    })
  })
}

/**
 * Finishes offboarding (A1): every order closed, then the whole available balance is paid out
 * (with approval above the threshold). The merchant is offboarded once nothing is left or the
 * final payout is on its way.
 */
export async function finishOffboarding(
  ctx: AuditContext,
  merchantId: number,
): Promise<{ status: string; payout: Payout | null }> {
  const merchant = await getMerchantById(merchantId)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
  if (merchant.lifecycle_status !== 'offboarding')
    throw new HttpError(409, 'LIFECYCLE_CONFLICT', 'Start offboarding first (pause → offboard)')
  const open = await openOrderCount(merchantId)
  if (open > 0)
    throw new HttpError(
      409,
      'OPEN_ORDERS',
      `${open} order(s) are still open; they must be closed first`,
      {
        openOrders: open,
      },
    )
  let payout: Payout | null = null
  if (merchant.stripe_account_id) {
    const pending = await listPayouts({ merchantId, status: 'pending_approval' })
    if (pending.length) return { status: 'offboarding', payout: pending[0] }
    const { availableCents } = await getGateway().retrieveBalance(merchant.stripe_account_id)
    if (availableCents > 0)
      payout = await requestPayout(ctx, {
        merchantId,
        amountCents: availableCents,
        reason: 'Final payout (offboarding)',
      })
  }
  await finishOffboardingIfDone(merchantId)
  const after = (await getMerchantById(merchantId))!
  await audit(getDb(), {
    ...ctx,
    action: 'merchant.offboard_finish',
    targetType: 'merchant',
    targetId: merchantId,
    data: { status: after.lifecycle_status, payoutId: payout?.id ?? null },
  })
  return { status: after.lifecycle_status, payout }
}

async function finishOffboardingIfDone(merchantId: number): Promise<void> {
  const merchant = await getMerchantById(merchantId)
  if (merchant?.lifecycle_status !== 'offboarding') return
  const pending = await listPayouts({ merchantId, status: 'pending_approval' })
  if (!pending.length && (await openOrderCount(merchantId)) === 0) await markOffboarded(merchantId)
}
