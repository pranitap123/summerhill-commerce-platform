import { getMerchantById } from '@/modules/merchant'
import { searchAuditLog } from '@/modules/ops'
import {
  getOrder,
  getOrderByPublicId,
  getOrderEvents,
  getOrderLines,
  type Order,
} from '@/modules/ordering'
import {
  getOrderLedger,
  getPaymentForOrder,
  listDisputes,
  listRefundsForOrder,
  refundableSummary,
} from '@/modules/payments'
import { listIssues } from '@/modules/support'
import { getDb } from '@/server/db'

/**
 * Order search and the full order page for /ops (G5-03, A5): "any order fully explained on one
 * page". The dossier gathers every record about an order from the modules that own them, and the
 * timeline merges them in time order: state changes and staff actions, notifications, Stripe
 * webhooks, payment, refunds, disputes, support issues, ledger journals and audit entries.
 */
export interface OrderSearchRow {
  id: number
  publicId: string
  status: string
  merchant: string
  email: string
  totalCents: number
  refundStatus: string
  placedAt: Date | null
  createdAt: Date
  pickupStartsAt: Date | null
  openIssues: number
  disputes: number
  rating: number | null
}

export async function searchOrders(filter: {
  q?: string
  status?: string
  merchantId?: number
  from?: Date
  to?: Date
  hasIssue?: boolean
  limit?: number
}): Promise<OrderSearchRow[]> {
  const q = filter.q?.trim() || null
  const { rows } = await getDb().query(
    `SELECT o.id, o.public_id, o.status, m.name AS merchant, o.email,
       COALESCE(o.final_total_cents, o.estimated_total_cents) AS total, o.refund_status, o.placed_at,
       o.created_at, o.pickup_starts_at, o.rating,
       (SELECT count(*) FROM commerce.support_issues i WHERE i.order_id = o.id AND i.status = 'open')::int AS open_issues,
       (SELECT count(*) FROM finance.disputes d WHERE d.order_id = o.id)::int AS disputes
     FROM commerce.orders o JOIN merchant.merchants m ON m.id = o.merchant_id
     WHERE ($1::text IS NULL OR o.public_id = upper($1) OR o.email ILIKE '%' || $1 || '%'
            OR o.pickup_name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR o.status = $2)
       AND ($3::bigint IS NULL OR o.merchant_id = $3)
       AND ($4::timestamptz IS NULL OR o.created_at >= $4)
       AND ($5::timestamptz IS NULL OR o.created_at < $5)
       AND ($6::boolean IS NOT TRUE OR EXISTS (SELECT 1 FROM commerce.support_issues i WHERE i.order_id = o.id))
     ORDER BY o.created_at DESC LIMIT $7`,
    [
      q,
      filter.status ?? null,
      filter.merchantId ?? null,
      filter.from ?? null,
      filter.to ?? null,
      filter.hasIssue ?? null,
      Math.min(filter.limit ?? 50, 200),
    ],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    publicId: r.public_id,
    status: r.status,
    merchant: r.merchant,
    email: r.email,
    totalCents: Number(r.total),
    refundStatus: r.refund_status,
    placedAt: r.placed_at,
    createdAt: r.created_at,
    pickupStartsAt: r.pickup_starts_at,
    openIssues: r.open_issues,
    disputes: r.disputes,
    rating: r.rating,
  }))
}

export interface TimelineEntry {
  at: Date
  source:
    | 'order'
    | 'payment'
    | 'refund'
    | 'dispute'
    | 'issue'
    | 'notification'
    | 'webhook'
    | 'ledger'
    | 'audit'
  title: string
  actor: string | null
  detail: Record<string, unknown> | null
}

export async function orderDossier(idOrPublicId: number | string) {
  const order: Order | null =
    typeof idOrPublicId === 'number'
      ? await getOrder(idOrPublicId)
      : await getOrderByPublicId(idOrPublicId)
  if (!order) return null
  const db = getDb()
  const [
    lines,
    events,
    payment,
    refunds,
    disputes,
    issues,
    ledger,
    merchant,
    notifications,
    journals,
    audits,
  ] = await Promise.all([
    getOrderLines(order.id),
    getOrderEvents(order.id),
    getPaymentForOrder(order.id),
    listRefundsForOrder(order.id),
    listDisputes({ orderId: order.id }),
    listIssues({ orderId: order.id }),
    getOrderLedger(order.id),
    getMerchantById(order.merchantId),
    db.query(
      `SELECT created_at, template, template_version, subject, status, sent_at FROM ops.notifications
         WHERE order_id = $1 ORDER BY id`,
      [order.id],
    ),
    db.query(
      `SELECT j.id, j.idempotency_key, j.event, j.external_ref, j.created_at,
           json_agg(json_build_object('account', e.account, 'debit', e.debit_cents, 'credit', e.credit_cents) ORDER BY e.id) AS entries
         FROM finance.ledger_journals j JOIN finance.ledger_entries e ON e.journal_id = j.id
         WHERE j.order_id = $1 GROUP BY j.id ORDER BY j.id`,
      [order.id],
    ),
    searchAuditLog({ targetType: 'order', targetId: String(order.id), limit: 100 }),
  ])
  const piId = payment?.paymentIntentId ?? null
  const sessionId = payment?.checkoutSessionId ?? null
  const webhooks = await db.query(
    `SELECT event_id, type, source, status, received_at, processed_at, attempts, last_error
     FROM ops.webhook_events
     WHERE ($1::text IS NOT NULL AND (payload->'data'->'object'->>'payment_intent' = $1
              OR payload->'data'->'object'->>'id' = $1))
        OR ($2::text IS NOT NULL AND payload->'data'->'object'->>'id' = $2)
        OR payload->'data'->'object'->'metadata'->>'order_id' = $3
     ORDER BY received_at LIMIT 100`,
    [piId, sessionId, String(order.id)],
  )

  const timeline: TimelineEntry[] = [
    ...events.map((e) => ({
      at: e.at,
      source: 'order' as const,
      title:
        e.type === 'status_changed' || e.type === 'created'
          ? `${e.fromStatus ?? 'new'} → ${e.toStatus}${e.reason ? ` (${e.reason})` : ''}`
          : `${e.type.replaceAll('_', ' ')}${e.reason ? `: ${e.reason}` : ''}`,
      actor: `${e.actorType}${e.actorId ? `:${e.actorId}` : ''}`,
      detail: Object.keys(e.data ?? {}).length ? e.data : null,
    })),
    ...notifications.rows.map((n) => ({
      at: n.created_at as Date,
      source: 'notification' as const,
      title: `Email "${n.subject}" (${n.template} v${n.template_version}): ${n.status}`,
      actor: 'system',
      detail: null,
    })),
    ...webhooks.rows.map((w) => ({
      at: w.received_at as Date,
      source: 'webhook' as const,
      title: `Stripe ${w.type} (${w.source}): ${w.status}${w.attempts > 1 ? `, ${w.attempts} attempts` : ''}`,
      actor: 'stripe',
      detail: { eventId: w.event_id, lastError: w.last_error },
    })),
    ...refunds.map((r) => ({
      at: r.createdAt,
      source: 'refund' as const,
      title: `Refund #${r.id} ${r.amountCents}¢ (${r.scenario}, ${r.liability} liability): ${r.status}`,
      actor: r.createdBy,
      detail: {
        lines: r.lines,
        reason: r.reason,
        stripeRefundId: r.stripeRefundId,
        feeRefundCents: r.feeRefundCents,
      },
    })),
    ...disputes.map((d) => ({
      at: d.createdAt,
      source: 'dispute' as const,
      title: `Dispute ${d.stripeDisputeId} (${d.reason}) ${d.amountCents}¢: ${d.status}`,
      actor: 'stripe',
      detail: { dueBy: d.evidenceDueBy, liability: d.liability },
    })),
    ...issues.map((i) => ({
      at: i.createdAt,
      source: 'issue' as const,
      title: `Problem reported (${i.type}), ${i.claimedCents}¢: ${i.status}`,
      actor: 'customer',
      detail: { description: i.description, lines: i.lines, decision: i.decision },
    })),
    ...journals.rows.map((j) => ({
      at: j.created_at as Date,
      source: 'ledger' as const,
      title: `Ledger journal ${j.idempotency_key} (${j.event})`,
      actor: null,
      detail: { entries: j.entries, externalRef: j.external_ref },
    })),
    ...audits.map((a) => ({
      at: a.at,
      source: 'audit' as const,
      title: `Audit: ${a.action}`,
      actor: `${a.actorType}${a.actorId ? `:${a.actorId}` : ''}`,
      detail: a.data,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    order,
    merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
    lines,
    payment,
    refunds,
    refundable: await refundableSummary(order.id),
    disputes,
    issues,
    ledger,
    timeline,
  }
}
export type OrderDossier = NonNullable<Awaited<ReturnType<typeof orderDossier>>>
