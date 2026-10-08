import { audit, emit, isEnabled, type AuditContext } from '@/modules/ops'
import { getOrder, getOrderLines, recordOrderEvent, type Order } from '@/modules/ordering'
import {
  createRefund,
  customerRefundTotal,
  lineRefundCents,
  listRefundsForOrder,
  type Refund,
  type RefundScenario,
} from '@/modules/payments'
import { getConfig } from '@/server/config'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { decideIssue, ISSUE_SCENARIO, type IssueType, type PolicyDecision } from './policy'

export const ISSUE_WINDOW_MS = 48 * 3600_000
const SYSTEM_CTX: AuditContext = { actor: { type: 'system', id: 'support-policy' } }

export interface SupportIssue {
  id: number
  orderId: number
  publicId: string
  type: IssueType
  lines: Array<{ lineId: number; quantity?: number; name?: string; amountCents?: number }>
  description: string | null
  claimedCents: number
  status: 'open' | 'auto_approved' | 'approved' | 'rejected'
  decision: PolicyDecision | Record<string, unknown>
  liability: 'merchant' | 'platform' | 'customer' | null
  refundId: number | null
  resolutionNote: string | null
  resolvedBy: string | null
  resolvedAt: Date | null
  createdAt: Date
}

type Row = Record<string, unknown>
function toIssue(r: Row): SupportIssue {
  return {
    id: Number(r.id),
    orderId: Number(r.order_id),
    publicId: String(r.public_id),
    type: r.type as IssueType,
    lines: r.lines as SupportIssue['lines'],
    description: (r.description as string) ?? null,
    claimedCents: Number(r.claimed_cents),
    status: r.status as SupportIssue['status'],
    decision: r.decision as SupportIssue['decision'],
    liability: (r.liability as SupportIssue['liability']) ?? null,
    refundId: r.refund_id === null ? null : Number(r.refund_id),
    resolutionNote: (r.resolution_note as string) ?? null,
    resolvedBy: (r.resolved_by as string) ?? null,
    resolvedAt: (r.resolved_at as Date) ?? null,
    createdAt: r.created_at as Date,
  }
}

const SELECT = `SELECT i.*, o.public_id FROM commerce.support_issues i
  JOIN commerce.orders o ON o.id = i.order_id`

export async function getIssue(id: number, db: Db = getDb()): Promise<SupportIssue | null> {
  const { rows } = await db.query(`${SELECT} WHERE i.id = $1`, [id])
  return rows[0] ? toIssue(rows[0]) : null
}

export async function listIssues(
  filter: { status?: SupportIssue['status']; orderId?: number } = {},
): Promise<SupportIssue[]> {
  const { rows } = await getDb().query(
    `${SELECT} WHERE ($1::text IS NULL OR i.status = $1) AND ($2::bigint IS NULL OR i.order_id = $2)
     ORDER BY i.id DESC LIMIT 200`,
    [filter.status ?? null, filter.orderId ?? null],
  )
  return rows.map(toIssue)
}

export function canReportIssue(
  order: Pick<Order, 'status' | 'collectedAt'>,
  now = new Date(),
): boolean {
  return (
    order.status === 'collected' &&
    !!order.collectedAt &&
    now.getTime() - order.collectedAt.getTime() <= ISSUE_WINDOW_MS
  )
}

export async function reportIssue(
  order: Order,
  input: {
    type: IssueType
    lines: Array<{ lineId: number; quantity?: number }>
    description: string | null
  },
  reporter: AuditContext,
  now: Date = new Date(),
): Promise<SupportIssue> {
  if (!canReportIssue(order, now))
    throw new HttpError(
      409,
      'ISSUE_WINDOW_CLOSED',
      'Problems can be reported within 48 hours of pickup',
    )
  if (input.type !== 'other' && !input.lines.length)
    throw new HttpError(400, 'VALIDATION_FAILED', 'Choose the items the problem is about')
  const open = await listIssues({ orderId: order.id, status: 'open' })
  if (open.length)
    throw new HttpError(
      409,
      'ISSUE_ALREADY_OPEN',
      'A report for this order is already being reviewed',
    )

  const orderLines = await getOrderLines(order.id)
  const refunds = (await listRefundsForOrder(order.id)).filter(
    (r) => r.status === 'pending' || r.status === 'succeeded',
  )
  const lines = input.lines.map((part) => {
    const line = orderLines.find((l) => l.id === part.lineId)
    if (!line || !line.finalLineTotalCents)
      throw new HttpError(422, 'LINE_NOT_FOUND', 'That item was not charged on this order')
    let cents: number
    try {
      cents = lineRefundCents(
        {
          id: line.id,
          isWeighed: line.isWeighed,
          finalLineTotalCents: line.finalLineTotalCents ?? 0,
          finalTaxCents: line.finalTaxCents ?? 0,
          finalDepositCents: line.finalDepositCents ?? 0,
          paidUnits: line.isWeighed ? 1 : (line.pickedQuantity ?? line.quantity ?? 1),
          paidWeightMlb: line.isWeighed ? line.actualWeightMlb : null,
        },
        part.quantity === undefined || line.isWeighed ? {} : { quantity: part.quantity },
      )
    } catch (err) {
      throw new HttpError(422, 'LINE_REFUND_INVALID', (err as Error).message)
    }
    const already = refunds.reduce(
      (s, r) =>
        s + r.lines.filter((l) => l.lineId === line.id).reduce((a, l) => a + l.amountCents, 0),
      0,
    )

    const left =
      (line.finalLineTotalCents ?? 0) +
      (line.finalTaxCents ?? 0) +
      (line.finalDepositCents ?? 0) -
      already
    return { ...part, name: line.name, amountCents: Math.max(0, Math.min(cents, left)) }
  })
  const claimedCents = lines.reduce((s, l) => s + l.amountCents, 0)
  const config = getConfig()
  const decision = decideIssue(
    {
      type: input.type,
      claimedCents,
      customer90DayRefundCents: await customerRefundTotal(
        { userId: order.userId, email: order.email },
        now,
      ),
      autoRefundEnabled: await isEnabled('support.auto_refund'),
    },
    {
      maxIssueCents: config.SUPPORT_AUTO_REFUND_MAX_CENTS,
      max90DayCents: config.SUPPORT_AUTO_REFUND_90D_MAX_CENTS,
    },
  )
  const issueId = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO commerce.support_issues (order_id, type, lines, description, claimed_cents, decision)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [order.id, input.type, JSON.stringify(lines), input.description, claimedCents, decision],
    )
    const id = Number(rows[0].id)
    await recordOrderEvent(tx, order.id, 'issue_reported', reporter.actor, {
      issueId: id,
      type: input.type,
      claimedCents,
      decision: decision.decision,
    })
    return id
  })

  if (decision.decision === 'auto_approve') {
    const scenario = ISSUE_SCENARIO[input.type] as RefundScenario
    await approveWithRefund(SYSTEM_CTX, issueId, order.id, {
      scenario,
      lines: lines
        .filter((l) => l.amountCents > 0)
        .map(({ lineId, quantity }) => ({ lineId, quantity })),
      status: 'auto_approved',
      note: 'Refunded automatically (within policy)',
      limitCents: null,
    })
  }
  return (await getIssue(issueId))!
}

async function approveWithRefund(
  ctx: AuditContext,
  issueId: number,
  orderId: number,
  opts: {
    scenario: RefundScenario
    lines?: Array<{ lineId: number; quantity?: number }>
    amountCents?: number
    liability?: 'merchant' | 'platform' | 'split'
    status: 'auto_approved' | 'approved'
    note: string | null
    limitCents: number | null
  },
): Promise<Refund> {
  const refund = await createRefund(ctx, {
    orderId,
    scenario: opts.scenario,
    ...(opts.lines?.length ? { lines: opts.lines } : { amountCents: opts.amountCents }),
    liability: opts.liability,
    reason: `Support issue #${issueId}${opts.note ? `: ${opts.note}` : ''}`,
    source: 'support_issue',
    issueId,
    limitCents: opts.limitCents,
  })
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE commerce.support_issues SET status = $2, liability = $3, refund_id = $4,
         resolution_note = $5, resolved_by = $6, resolved_at = now() WHERE id = $1`,
      [
        issueId,
        opts.status,
        refund.liability === 'platform' ? 'platform' : 'merchant',
        refund.id,
        opts.note,
        ctx.actor.id,
      ],
    )
    await recordOrderEvent(tx, orderId, 'issue_resolved', ctx.actor, {
      issueId,
      status: opts.status,
      refundId: refund.id,
      amountCents: refund.amountCents,
    })
  })
  return refund
}

export async function resolveIssue(
  ctx: AuditContext,
  issueId: number,
  input: {
    decision: 'approve' | 'reject'
    note: string
    scenario?: RefundScenario
    amountCents?: number
    liability?: 'merchant' | 'platform' | 'split'
    limitCents: number | null
  },
): Promise<SupportIssue> {
  const issue = await getIssue(issueId)
  if (!issue) throw new HttpError(404, 'NOT_FOUND', 'Issue not found')
  if (issue.status !== 'open')
    throw new HttpError(409, 'ISSUE_RESOLVED', `This issue is already ${issue.status}`)
  if (input.decision === 'reject') {
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE commerce.support_issues SET status = 'rejected', liability = 'customer',
           resolution_note = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 AND status = 'open'`,
        [issueId, input.note, ctx.actor.id],
      )
      await recordOrderEvent(
        tx,
        issue.orderId,
        'issue_resolved',
        ctx.actor,
        { issueId, status: 'rejected' },
        input.note,
      )
      await emit(tx, 'order.issue_rejected', issue.orderId, { orderId: issue.orderId, issueId })
      await audit(tx, {
        ...ctx,
        action: 'issue.reject',
        targetType: 'issue',
        targetId: issueId,
        data: { note: input.note },
      })
    })
    return (await getIssue(issueId))!
  }
  const scenario = input.scenario ?? (ISSUE_SCENARIO[issue.type] as RefundScenario | null)
  if (!scenario)
    throw new HttpError(
      400,
      'VALIDATION_FAILED',
      'Choose the liability-matrix case for this issue (scenario)',
    )
  const useLines = input.amountCents === undefined && issue.lines.length > 0
  await approveWithRefund(ctx, issueId, issue.orderId, {
    scenario,
    lines: useLines
      ? issue.lines
          .filter((l) => (l.amountCents ?? 1) > 0)
          .map(({ lineId, quantity }) => ({ lineId, quantity }))
      : undefined,
    amountCents: useLines ? undefined : (input.amountCents ?? issue.claimedCents),
    liability: input.liability,
    status: 'approved',
    note: input.note,
    limitCents: input.limitCents,
  })
  await audit(getDb(), {
    ...ctx,
    action: 'issue.approve',
    targetType: 'issue',
    targetId: issueId,
    data: { scenario, note: input.note },
  })
  return (await getIssue(issueId))!
}

export async function issueContext(issueId: number) {
  const issue = await getIssue(issueId)
  if (!issue) throw new HttpError(404, 'NOT_FOUND', 'Issue not found')
  const order = (await getOrder(issue.orderId))!
  const { rows } = await getDb().query(
    `${SELECT} WHERE i.id <> $1 AND (lower(o.email) = lower($2) OR ($3::text IS NOT NULL AND o.user_id = $3))
     ORDER BY i.id DESC LIMIT 20`,
    [issueId, order.email, order.userId],
  )
  return {
    issue,
    customer90DayRefundCents: await customerRefundTotal({
      userId: order.userId,
      email: order.email,
    }),
    previousIssues: rows.map(toIssue),
  }
}
