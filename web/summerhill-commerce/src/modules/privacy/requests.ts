import { createHash } from 'node:crypto'

import { getUserDirectory, isPlatformStaff, resetMfa, type DirectoryUser } from '@/modules/identity'
import { deactivateStaffMemberships, listStaffMemberships } from '@/modules/merchant'
import { audit, type AuditContext } from '@/modules/ops'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { ANONYMISED_DOMAIN } from './retention'

export const PERSONAL_FIELDS = {
  account: ['email', 'name', 'roles', 'defaultReplacementPreference', 'createdAt'],
  order: [
    'publicId',
    'email',
    'pickupName',
    'arrivalNote',
    'ratingComment',
    'rating',
    'ratingTags',
    'placedAt',
    'pickupStartsAt',
  ],
  issue: ['type', 'description', 'createdAt'],
  notification: ['template', 'subject', 'sentAt'],
} as const

export type Subject = { userId: string; email: string } | { userId: null; email: string }

const hashSubject = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

export async function resolveSubject(input: { userId?: string; email?: string }): Promise<{
  subject: Subject
  account: DirectoryUser | null
}> {
  const directory = getUserDirectory()
  const account = input.userId
    ? await directory.get(input.userId)
    : input.email
      ? await directory.findByEmail(input.email)
      : null
  const email = account?.email ?? input.email?.trim().toLowerCase()
  if (!email) throw new HttpError(404, 'NOT_FOUND', 'No account or orders for that person')
  return { subject: account ? { userId: account.id, email } : { userId: null, email }, account }
}

export async function exportPersonalData(
  ctx: AuditContext,
  input: { userId?: string; email?: string },
): Promise<Record<string, unknown>> {
  const { subject, account } = await resolveSubject(input)
  const db = getDb()
  const orders = await db.query(
    `SELECT id, public_id, status, email, pickup_name, arrival_note, rating, rating_tags, rating_comment,
       placed_at, pickup_starts_at, created_at, COALESCE(final_total_cents, estimated_total_cents) AS total_cents
     FROM commerce.orders WHERE ($1::text IS NOT NULL AND user_id = $1) OR lower(email) = lower($2)
     ORDER BY id`,
    [subject.userId, subject.email],
  )
  const ids = orders.rows.map((o) => o.id)
  const [lines, issues, notifications] = await Promise.all([
    db.query(
      `SELECT order_id, name, quantity, actual_weight_lb, final_line_total_cents, status
       FROM commerce.order_lines WHERE order_id = ANY($1::bigint[]) ORDER BY order_id, line_no`,
      [ids],
    ),
    db.query(
      `SELECT order_id, type, description, status, created_at FROM commerce.support_issues
       WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
      [ids],
    ),
    db.query(
      `SELECT order_id, template, subject, status, sent_at FROM ops.notifications
       WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
      [ids],
    ),
  ])
  const data = {
    exportedAt: new Date().toISOString(),
    note: 'Personal data held by the Grocery Marketplace Demo (test mode). Payment card data is held by Stripe only.',
    account: account
      ? {
          email: account.email,
          name: account.name,
          roles: account.roles,
          defaultReplacementPreference: account.defaultReplacementPreference,
          createdAt: account.createdAt,
        }
      : null,
    orders: orders.rows.map((o) => ({
      publicId: o.public_id,
      status: o.status,
      email: o.email,
      pickupName: o.pickup_name,
      arrivalNote: o.arrival_note,
      rating: o.rating,
      ratingTags: o.rating_tags,
      ratingComment: o.rating_comment,
      placedAt: o.placed_at,
      pickupStartsAt: o.pickup_starts_at,
      totalCents: Number(o.total_cents),
      lines: lines.rows
        .filter((l) => l.order_id === o.id)
        .map((l) => ({
          name: l.name,
          quantity: l.quantity,
          weightLb: l.actual_weight_lb,
          totalCents: l.final_line_total_cents === null ? null : Number(l.final_line_total_cents),
          status: l.status,
        })),
      issues: issues.rows
        .filter((i) => i.order_id === o.id)
        .map((i) => ({
          type: i.type,
          description: i.description,
          status: i.status,
          createdAt: i.created_at,
        })),
      notifications: notifications.rows
        .filter((n) => n.order_id === o.id)
        .map((n) => ({
          template: n.template,
          subject: n.subject,
          status: n.status,
          sentAt: n.sent_at,
        })),
    })),
  }
  await record(ctx, 'export', subject.email, { orders: orders.rows.length, account: !!account })
  return data
}

export async function deletePersonalData(
  ctx: AuditContext,
  input: { userId?: string; email?: string },
): Promise<{ ordersAnonymised: number; accountClosed: boolean }> {
  const { subject, account } = await resolveSubject(input)
  if (account && isPlatformStaff({ id: account.id, email: account.email, roles: account.roles }))
    throw new HttpError(409, 'STAFF_ACCOUNT', 'Remove the staff roles before deleting this account')
  if (account && (await listStaffMemberships(account.id)).length)
    throw new HttpError(
      409,
      'STAFF_ACCOUNT',
      'Remove the store memberships before deleting this account',
    )

  const result = await withTransaction(async (tx) => {
    const orders = await tx.query<{ id: string }>(
      `UPDATE commerce.orders SET email = 'deleted-' || id || '@${ANONYMISED_DOMAIN}', pickup_name = NULL,
         arrival_note = NULL, rating_comment = NULL, user_id = NULL
       WHERE ($1::text IS NOT NULL AND user_id = $1) OR lower(email) = lower($2) RETURNING id`,
      [subject.userId, subject.email],
    )
    const ids = orders.rows.map((r) => Number(r.id))
    await tx.query(
      'UPDATE commerce.support_issues SET description = NULL WHERE order_id = ANY($1::bigint[])',
      [ids],
    )
    if (subject.userId) {
      await tx.query('UPDATE commerce.carts SET user_id = NULL WHERE user_id = $1', [
        subject.userId,
      ])
      await deactivateStaffMemberships(tx, subject.userId)
    }
    return { ordersAnonymised: ids.length }
  })
  if (account) {
    const directory = getUserDirectory()
    await directory.update(account.id, {
      email: `deleted-${account.id}@${ANONYMISED_DOMAIN}`,
      name: null,
      roles: ['customer'],
      deactivatedAt: new Date(),
    })
    await directory.scramblePassword(account.id)
    await directory.endSessions(account.id)
    await resetMfa(account.id)
  }
  await record(ctx, 'deletion', subject.email, { ...result, accountClosed: !!account })
  return { ...result, accountClosed: !!account }
}

async function record(
  ctx: AuditContext,
  kind: 'export' | 'deletion',
  email: string,
  summary: Record<string, unknown>,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO ops.privacy_requests (kind, subject_hash, requested_by, summary)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [kind, hashSubject(email), `${ctx.actor.type}:${ctx.actor.id ?? ''}`, summary],
    )
    await audit(tx, {
      ...ctx,
      action: `privacy.${kind}`,
      targetType: 'privacy_request',
      targetId: Number(rows[0].id),
      data: summary,
    })
  })
}

export async function listPrivacyRequests(limit = 50) {
  const { rows } = await getDb().query(
    'SELECT id, kind, requested_by, summary, completed_at FROM ops.privacy_requests ORDER BY id DESC LIMIT $1',
    [limit],
  )
  return rows
}
