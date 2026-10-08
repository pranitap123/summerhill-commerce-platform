import { audit, raiseAlert, type AuditContext } from '@/modules/ops'
import {
  getOrder,
  getOrderEvents,
  getOrderLines,
  recordOrderEvent,
  type Order,
} from '@/modules/ordering'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { getGateway } from './gateway'
import { postJournal } from './ledger'
import { postDispute, postDisputeCredit } from './ledgerRules'
import { getPaymentByIntent, getPaymentForOrder } from './repository'

export const DISPUTE_ALERT_HOURS = [72, 24] as const

export interface Dispute {
  id: number
  stripeDisputeId: string
  paymentId: number
  orderId: number
  publicId: string
  amountCents: number
  feeCents: number
  reason: string
  status: string
  evidenceDueBy: Date | null
  evidence: EvidencePack | null
  evidenceBuiltAt: Date | null
  submittedAt: Date | null
  submittedBy: string | null
  liability: 'merchant' | 'platform' | null
  recoveredCents: number
  reinstatedCents: number
  createdAt: Date
  closedAt: Date | null
}

export interface EvidencePack {
  summary: string
  order: {
    publicId: string
    status: string
    placedAt: string | null
    pickupWindow: [string | null, string | null]
    totalCents: number | null
  }
  customer: { email: string; pickupName: string | null }
  receipt: Array<{
    name: string
    quantity: string
    totalCents: number | null
    taxCents: number | null
  }>
  handover: {
    collected: boolean
    collectedAt: string | null
    handedOverBy: string | null
    pickupCodeVerified: boolean
    wrongCodeAttempts: number
  }
  timeline: Array<{ at: string; type: string; to: string | null; actor: string }>
  notifications: Array<{ at: string; template: string; subject: string; status: string }>
  payment: {
    paymentIntentId: string | null
    chargeId: string | null
    authorizedCents: number | null
    capturedCents: number | null
    authorizedAt: string | null
    capturedAt: string | null
  }

  notRecorded: string[]

  stripeEvidence: Record<string, string>
}

type Row = Record<string, unknown>
function toDispute(r: Row): Dispute {
  return {
    id: Number(r.id),
    stripeDisputeId: String(r.stripe_dispute_id),
    paymentId: Number(r.payment_id),
    orderId: Number(r.order_id),
    publicId: String(r.public_id),
    amountCents: Number(r.amount_cents),
    feeCents: Number(r.fee_cents),
    reason: String(r.reason),
    status: String(r.status),
    evidenceDueBy: (r.evidence_due_by as Date) ?? null,
    evidence: (r.evidence as EvidencePack) ?? null,
    evidenceBuiltAt: (r.evidence_built_at as Date) ?? null,
    submittedAt: (r.submitted_at as Date) ?? null,
    submittedBy: (r.submitted_by as string) ?? null,
    liability: (r.liability as Dispute['liability']) ?? null,
    recoveredCents: Number(r.recovered_cents),
    reinstatedCents: Number(r.reinstated_cents),
    createdAt: r.created_at as Date,
    closedAt: (r.closed_at as Date) ?? null,
  }
}

const SELECT = `SELECT d.*, o.public_id FROM finance.disputes d
  JOIN commerce.orders o ON o.id = d.order_id`

export async function getDispute(id: number, db: Db = getDb()): Promise<Dispute | null> {
  const { rows } = await db.query(`${SELECT} WHERE d.id = $1`, [id])
  return rows[0] ? toDispute(rows[0]) : null
}

export async function listDisputes(
  filter: { open?: boolean; orderId?: number } = {},
): Promise<Dispute[]> {
  const { rows } = await getDb().query(
    `${SELECT}
     WHERE ($1::boolean IS NOT TRUE OR d.status IN ('needs_response', 'warning_needs_response', 'under_review', 'warning_under_review'))
       AND ($2::bigint IS NULL OR d.order_id = $2)
     ORDER BY d.evidence_due_by NULLS LAST, d.id DESC LIMIT 200`,
    [filter.open ?? null, filter.orderId ?? null],
  )
  return rows.map(toDispute)
}

export interface StripeDisputeLike {
  id: string
  amount: number
  charge: string | { id: string }
  payment_intent?: string | { id: string } | null
  reason: string
  status: string
  evidence_details?: { due_by?: number | null } | null
  balance_transactions?: Array<{ fee?: number }> | null
}

const idOf = (v: string | { id: string } | null | undefined) =>
  typeof v === 'string' ? v : (v?.id ?? null)

export async function onDisputeEvent(
  type: string,
  d: StripeDisputeLike,
): Promise<'processed' | 'ignored'> {
  if (type === 'charge.dispute.created') return disputeCreated(d)
  const existing = await getDb().query<{ id: string }>(
    'SELECT id FROM finance.disputes WHERE stripe_dispute_id = $1',
    [d.id],
  )
  if (!existing.rows[0]) return type === 'charge.dispute.updated' ? disputeCreated(d) : 'ignored'
  const id = Number(existing.rows[0].id)
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE finance.disputes SET status = $2,
         evidence_due_by = COALESCE(to_timestamp($3), evidence_due_by),
         closed_at = CASE WHEN $2 IN ('won', 'lost', 'warning_closed') THEN COALESCE(closed_at, now()) END
       WHERE id = $1`,
      [id, d.status, d.evidence_details?.due_by ?? null],
    )
    if (type === 'charge.dispute.closed') {
      const dispute = (await getDispute(id, tx))!
      await recordOrderEvent(
        tx,
        dispute.orderId,
        'dispute_closed',
        { type: 'stripe', id: d.id },
        {
          disputeId: id,
          status: d.status,
        },
      )
      if (d.status === 'lost')
        await raiseAlert(tx, {
          kind: 'dispute.lost',
          dedupeKey: `dispute-lost:${d.id}`,
          severity: 'warning',
          message: `Dispute on order ${dispute.publicId} was lost (${dispute.amountCents}¢)`,
          data: { disputeId: id, orderId: dispute.orderId },
        })
    }
  })
  return 'processed'
}

export async function onDisputeFundsReinstated(
  d: StripeDisputeLike,
): Promise<'processed' | 'ignored'> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      'SELECT * FROM finance.disputes WHERE stripe_dispute_id = $1 FOR UPDATE',
      [d.id],
    )
    if (!rows[0]) return 'ignored' as const
    const id = Number(rows[0].id)
    const posted = await postJournal(tx, {
      key: `dispute-reinstated:${id}`,
      event: 'dispute_reinstated',
      orderId: Number(rows[0].order_id),
      externalRef: d.id,
      entries: postDisputeCredit(d.amount),
    })
    if (posted)
      await tx.query('UPDATE finance.disputes SET reinstated_cents = $2 WHERE id = $1', [
        id,
        d.amount,
      ])
    return 'processed' as const
  })
}

async function disputeCreated(d: StripeDisputeLike): Promise<'processed' | 'ignored'> {
  const piId = idOf(d.payment_intent)
  const payment = piId ? await getPaymentByIntent(piId) : await paymentByCharge(idOf(d.charge))
  if (!payment) return 'ignored'
  const fee = (d.balance_transactions ?? []).reduce((s, t) => s + (t.fee ?? 0), 0)
  const id = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO finance.disputes (stripe_dispute_id, payment_id, order_id, amount_cents, fee_cents,
         reason, status, evidence_due_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
       ON CONFLICT (stripe_dispute_id) DO NOTHING RETURNING id`,
      [
        d.id,
        payment.id,
        payment.orderId,
        d.amount,
        fee,
        d.reason,
        d.status,
        d.evidence_details?.due_by ?? null,
      ],
    )
    if (!rows[0]) return null
    const disputeId = Number(rows[0].id)
    await postJournal(tx, {
      key: `dispute:${disputeId}`,
      event: 'dispute',
      orderId: payment.orderId,
      externalRef: d.id,
      entries: postDispute({ amountCents: d.amount, feeCents: fee }),
    })
    await recordOrderEvent(
      tx,
      payment.orderId,
      'dispute_opened',
      { type: 'stripe', id: d.id },
      {
        disputeId,
        amountCents: d.amount,
        reason: d.reason,
      },
    )
    await raiseAlert(tx, {
      kind: 'dispute.created',
      dedupeKey: `dispute:${d.id}`,
      severity: 'critical',
      message: `Chargeback (${d.reason}) of ${d.amount}¢ on order ${payment.orderId}; evidence due ${
        d.evidence_details?.due_by
          ? new Date(d.evidence_details.due_by * 1000).toISOString()
          : 'n/a'
      }`,
      data: { disputeId, orderId: payment.orderId, reason: d.reason },
    })
    return disputeId
  })
  if (id !== null) await buildEvidencePack(id)
  return 'processed'
}

async function paymentByCharge(chargeId: string | null) {
  if (!chargeId) return null
  const { rows } = await getDb().query<{ order_id: string }>(
    'SELECT order_id FROM finance.payments WHERE charge_id = $1',
    [chargeId],
  )
  return rows[0] ? getPaymentForOrder(Number(rows[0].order_id)) : null
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

export async function buildEvidencePack(disputeId: number): Promise<EvidencePack> {
  const dispute = await getDispute(disputeId)
  if (!dispute) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found')
  const order = (await getOrder(dispute.orderId))!
  const [lines, events, payment, notifications] = await Promise.all([
    getOrderLines(order.id),
    getOrderEvents(order.id),
    getPaymentForOrder(order.id),
    getDb().query<{ created_at: Date; template: string; subject: string; status: string }>(
      `SELECT created_at, template, subject, status FROM ops.notifications
       WHERE order_id = $1 ORDER BY id`,
      [order.id],
    ),
  ])
  const collected = events.find((e) => e.toStatus === 'collected')
  const wrongCodes = events.filter(
    (e) => e.type === 'handover_failed' || e.type === 'handover_locked',
  ).length
  const receipt = lines
    .filter((l) => (l.finalLineTotalCents ?? 0) > 0)
    .map((l) => ({
      name: l.name,
      quantity: l.isWeighed
        ? `${((l.actualWeightMlb ?? l.estimatedWeightMlb ?? 0) / 1000).toFixed(3)} lb`
        : String(l.pickedQuantity ?? l.quantity ?? 1),
      totalCents: l.finalLineTotalCents,
      taxCents: l.finalTaxCents,
    }))
  const handover = {
    collected: order.status === 'collected' || !!order.collectedAt,
    collectedAt: iso(order.collectedAt),
    handedOverBy: order.handedOverBy,

    pickupCodeVerified: !!collected,
    wrongCodeAttempts: wrongCodes,
  }
  const summary = handover.collected
    ? `Order ${order.publicId} was collected in store on ${handover.collectedAt} after staff member ${handover.handedOverBy} verified the 6-digit pickup code that was sent only to ${order.email}.`
    : `Order ${order.publicId} has not been collected (status: ${order.status}).`
  const money = (c: number | null) => (c === null ? 'n/a' : `$${(c / 100).toFixed(2)}`)
  const pack: EvidencePack = {
    summary,
    order: {
      publicId: order.publicId,
      status: order.status,
      placedAt: iso(order.placedAt),
      pickupWindow: [iso(order.pickupStartsAt), iso(order.pickupEndsAt)],
      totalCents: order.finalTotalCents,
    },
    customer: { email: order.email, pickupName: order.pickupName },
    receipt,
    handover,
    timeline: events.map((e) => ({
      at: iso(e.at)!,
      type: e.type,
      to: e.toStatus,
      actor: `${e.actorType}${e.actorId ? `:${e.actorId}` : ''}`,
    })),
    notifications: notifications.rows.map((n) => ({
      at: iso(n.created_at)!,
      template: n.template,
      subject: n.subject,
      status: n.status,
    })),
    payment: {
      paymentIntentId: payment?.paymentIntentId ?? null,
      chargeId: payment?.chargeId ?? null,
      authorizedCents: payment?.amountAuthorizedCents ?? null,
      capturedCents: payment?.amountCapturedCents ?? null,
      authorizedAt: iso(events.find((e) => e.toStatus === 'placed')?.at),
      capturedAt: iso(events.find((e) => e.toStatus === 'ready')?.at),
    },
    notRecorded: ['IP address and device at checkout (not stored in v1)'],
    stripeEvidence: {
      product_description:
        `Groceries for in-store pickup: ${receipt.map((r) => `${r.name} (${r.quantity})`).join(', ')}`.slice(
          0,
          20_000,
        ),
      customer_email_address: order.email,
      ...(order.pickupName ? { customer_name: order.pickupName } : {}),
      service_date: (handover.collectedAt ?? iso(order.pickupStartsAt) ?? '').slice(0, 10),
      access_activity_log: events
        .map(
          (e) => `${iso(e.at)} ${e.type}${e.toStatus ? ` → ${e.toStatus}` : ''} (${e.actorType})`,
        )
        .join('\n')
        .slice(0, 20_000),
      uncategorized_text: [
        summary,
        `Charged ${money(payment?.amountCapturedCents ?? null)} after picking; receipt emailed at ${
          notifications.rows.find((n) => n.template === 'order_ready')?.created_at?.toISOString() ??
          'n/a'
        }.`,
      ].join('\n'),
    },
  }
  await getDb().query(
    'UPDATE finance.disputes SET evidence = $2, evidence_built_at = now() WHERE id = $1',
    [disputeId, JSON.stringify(pack)],
  )
  return pack
}

export async function submitDisputeEvidence(
  ctx: AuditContext,
  disputeId: number,
): Promise<Dispute> {
  const dispute = await getDispute(disputeId)
  if (!dispute) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found')
  if (!['needs_response', 'warning_needs_response'].includes(dispute.status))
    throw new HttpError(
      409,
      'DISPUTE_NOT_OPEN',
      `Evidence can't be submitted when the dispute is ${dispute.status}`,
    )
  const pack = await buildEvidencePack(disputeId)
  const { status } = await getGateway().submitDisputeEvidence(
    dispute.stripeDisputeId,
    pack.stripeEvidence,
  )
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE finance.disputes SET status = $2, submitted_at = now(), submitted_by = $3 WHERE id = $1`,
      [disputeId, status, ctx.actor.id],
    )
    await recordOrderEvent(tx, dispute.orderId, 'dispute_evidence_submitted', ctx.actor, {
      disputeId,
    })
    await audit(tx, {
      ...ctx,
      action: 'dispute.submit',
      targetType: 'dispute',
      targetId: disputeId,
      data: { stripeDisputeId: dispute.stripeDisputeId },
    })
  })
  return (await getDispute(disputeId))!
}

export function suggestedDisputeLiability(
  order: Pick<Order, 'status' | 'collectedAt' | 'handedOverBy'>,
  codeVerified: boolean,
): 'merchant' | 'platform' {
  const handedOver = order.status === 'collected' || !!order.collectedAt
  return handedOver && !codeVerified ? 'merchant' : 'platform'
}

export async function setDisputeLiability(
  ctx: AuditContext,
  disputeId: number,
  input: { liability: 'merchant' | 'platform'; recoverCents?: number },
): Promise<Dispute> {
  const dispute = await getDispute(disputeId)
  if (!dispute) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found')
  const recover =
    input.liability === 'merchant'
      ? (input.recoverCents ?? dispute.amountCents - dispute.recoveredCents)
      : 0
  if (recover < 0 || dispute.recoveredCents + recover > dispute.amountCents)
    throw new HttpError(422, 'RECOVERY_TOO_LARGE', 'Recovery exceeds the disputed amount')
  if (recover > 0) {
    const payment = await getPaymentForOrder(dispute.orderId)
    if (!payment?.chargeId) throw new HttpError(409, 'NO_CHARGE', 'No charge to recover from')
    const reversal = await getGateway().reverseTransfer(
      {
        chargeId: payment.chargeId,
        amountCents: recover,
        refundApplicationFee: false,
        metadata: { dispute_id: String(disputeId), order_id: String(dispute.orderId) },
      },
      `dispute-recovery:${disputeId}:${dispute.recoveredCents + recover}`,
    )
    await withTransaction(async (tx) => {
      await postJournal(tx, {
        key: `dispute-recovery:${disputeId}:${dispute.recoveredCents + recover}`,
        event: 'dispute_recovery',
        orderId: dispute.orderId,
        externalRef: reversal.id,
        entries: postDisputeCredit(recover),
      })
      await tx.query(
        'UPDATE finance.disputes SET recovered_cents = recovered_cents + $2 WHERE id = $1',
        [disputeId, recover],
      )
    })
  }
  await withTransaction(async (tx) => {
    await tx.query('UPDATE finance.disputes SET liability = $2 WHERE id = $1', [
      disputeId,
      input.liability,
    ])
    await audit(tx, {
      ...ctx,
      action: 'dispute.liability',
      targetType: 'dispute',
      targetId: disputeId,
      data: { liability: input.liability, recoveredCents: recover },
    })
  })
  return (await getDispute(disputeId))!
}

export async function runDisputeDeadlineAlerts(now: Date = new Date()): Promise<number> {
  let raised = 0
  for (const hours of DISPUTE_ALERT_HOURS) {
    const column = hours === 72 ? 'alerted_72h_at' : 'alerted_24h_at'
    const { rows } = await getDb().query<{ id: string; order_id: string; evidence_due_by: Date }>(
      `SELECT id, order_id, evidence_due_by FROM finance.disputes
       WHERE status IN ('needs_response', 'warning_needs_response') AND ${column} IS NULL
         AND evidence_due_by IS NOT NULL AND evidence_due_by <= $1 AND evidence_due_by > $2`,
      [new Date(now.getTime() + hours * 3600_000), now],
    )
    for (const r of rows)
      await withTransaction(async (tx) => {
        await raiseAlert(tx, {
          kind: 'dispute.due_soon',
          dedupeKey: `dispute-due:${r.id}:${hours}`,
          severity: hours === 24 ? 'critical' : 'warning',
          message: `Dispute ${r.id}: evidence due within ${hours} h (${r.evidence_due_by.toISOString()})`,
          data: { disputeId: Number(r.id), orderId: Number(r.order_id), hours },
        })
        await tx.query(`UPDATE finance.disputes SET ${column} = $2 WHERE id = $1`, [r.id, now])
        raised++
      })
  }
  return raised
}
