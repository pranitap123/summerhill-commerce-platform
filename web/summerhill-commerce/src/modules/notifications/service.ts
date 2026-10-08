import { createHash } from 'node:crypto'

import { getMerchantById } from '@/modules/merchant'
import { handleOnce, isEnabled, type OutboxEvent } from '@/modules/ops'
import { getOrder, getOrderLines, orderAccessToken, type Order } from '@/modules/ordering'
import { getConfig } from '@/server/config'
import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import { getMailer } from './mailer'
import {
  issueRejected,
  orderRefunded,
  orderCancelled,
  orderConfirmation,
  orderLookupLink,
  orderReady,
  orderSubstitution,
  opsAlert,
  type Rendered,
} from './templates'

export const NOTIFY_QUEUE = 'notify.order'

export const ALERT_NOTIFY_QUEUE = 'notify.alert'

export function orderUrl(order: Pick<Order, 'publicId' | 'accessVersion'>): string {
  return `${getConfig().NEXT_PUBLIC_SERVER_URL}/orders/${order.publicId}?t=${encodeURIComponent(orderAccessToken(order))}`
}

const hashRecipient = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

async function deliver(
  db: Db,
  to: string,
  rendered: Rendered,
  dedupeKey: string,
  orderId: number | null,
): Promise<'sent' | 'skipped' | 'duplicate'> {
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM ops.notifications WHERE dedupe_key = $1',
    [dedupeKey],
  )
  if (rows[0]) return 'duplicate'
  const enabled = await isEnabled('email.enabled', db)
  let providerId: string | null = null
  if (enabled) providerId = (await getMailer().send({ to, ...rendered })).messageId
  await db.query(
    `INSERT INTO ops.notifications (dedupe_key, template, template_version, channel, recipient_hash,
       order_id, subject, status, provider_id, sent_at)
     VALUES ($1, $2, $3, 'email', $4, $5, $6, $7, $8, CASE WHEN $7 = 'sent' THEN now() END)`,
    [
      dedupeKey,
      rendered.template,
      rendered.version,
      hashRecipient(to),
      orderId,
      rendered.subject,
      enabled ? 'sent' : 'skipped',
      providerId,
    ],
  )
  return enabled ? 'sent' : 'skipped'
}

export async function handleOrderNotification(event: OutboxEvent): Promise<void> {
  await handleOnce(NOTIFY_QUEUE, event.eventId, async (tx) => {
    const orderId = Number(event.payload.orderId)
    const order = await getOrder(orderId, tx)
    if (!order) return
    if (event.topic === 'order.placed') {
      const lines = await getOrderLines(orderId, tx)
      await deliver(
        tx,
        order.email,
        orderConfirmation(order, lines, orderUrl(order)),
        `order_confirmation:${orderId}`,
        orderId,
      )
    } else if (event.topic === 'order.cancelled') {
      const reason = (event.payload.reason as string | null) ?? null
      await deliver(
        tx,
        order.email,
        orderCancelled(order, orderUrl(order), reason),
        `order_cancelled:${orderId}`,
        orderId,
      )
    } else if (event.topic === 'order.ready') {
      const merchant = await getMerchantById(order.merchantId)
      await deliver(
        tx,
        order.email,
        orderReady(
          order,
          await getOrderLines(orderId, tx),
          {
            name: merchant?.name ?? 'the store',
            hstRegistrationNumber: merchant?.hst_registration_number ?? null,
          },
          orderUrl(order),
        ),
        `order_ready:${orderId}`,
        orderId,
      )
    } else if (event.topic === 'order.refunded') {
      const refundId = Number(event.payload.refundId)
      const { rows } = await tx.query<{ amount_cents: string; lines: Array<{ lineId: number }> }>(
        'SELECT amount_cents, lines FROM finance.refunds WHERE id = $1',
        [refundId],
      )
      if (!rows[0]) return
      const names = await getOrderLines(orderId, tx)
      await deliver(
        tx,
        order.email,
        orderRefunded(
          order,
          {
            amountCents: Number(rows[0].amount_cents),
            lines: rows[0].lines.map((l) => ({
              name: names.find((n) => n.id === l.lineId)?.name ?? 'an item',
            })),
          },
          orderUrl(order),
        ),
        `order_refunded:${refundId}`,
        orderId,
      )
    } else if (event.topic === 'order.issue_rejected') {
      const issueId = Number(event.payload.issueId)
      const { rows } = await tx.query<{ resolution_note: string | null }>(
        'SELECT resolution_note FROM commerce.support_issues WHERE id = $1',
        [issueId],
      )
      await deliver(
        tx,
        order.email,
        issueRejected(order, rows[0]?.resolution_note ?? '', orderUrl(order)),
        `issue_rejected:${issueId}`,
        orderId,
      )
    } else if (event.topic === 'order.line_substituted') {
      const lines = await getOrderLines(orderId, tx)
      const original = lines.find((l) => l.id === Number(event.payload.lineId))
      const substitute = lines.find((l) => l.id === Number(event.payload.substituteLineId))

      if (original && substitute)
        await deliver(
          tx,
          order.email,
          orderSubstitution(order, original, substitute, orderUrl(order)),
          `order_substitution:${substitute.id}`,
          orderId,
        )
    }
  })
}

export async function sendOrderLookupLink(order: Order): Promise<void> {
  const bucket = Math.floor(Date.now() / 60_000)
  await deliver(
    getDb(),
    order.email,
    orderLookupLink(order.publicId, orderUrl(order)),
    `order_lookup:${order.id}:${bucket}`,
    order.id,
  )
}

export async function handleAlertNotification(event: OutboxEvent): Promise<void> {
  const p = event.payload as {
    alertId: number
    kind: string
    severity: string
    message: string
    sev: string
    channel: 'page' | 'ops' | 'finance'
    runbook: string
  }
  const c = getConfig()
  const to = { page: c.ALERT_EMAIL_PAGE, ops: c.ALERT_EMAIL_OPS, finance: c.ALERT_EMAIL_FINANCE }[
    p.channel
  ]
  await deliver(
    getDb(),
    to,
    opsAlert({ ...p, opsUrl: `${c.NEXT_PUBLIC_SERVER_URL}/ops` }),
    `ops_alert:${p.alertId}`,
    null,
  )
}
