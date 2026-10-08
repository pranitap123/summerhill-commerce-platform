import { withTransaction } from '@/server/db'

export const RETENTION = {
  orderContactYears: 7,
  notificationDays: 365,
  searchAnalyticsDays: 396, // 13 months
  webhookPayloadDays: 90,
  simulatorDays: 90,
} as const

export const ANONYMISED_DOMAIN = 'anonymised.invalid'

export interface PurgeResult {
  ordersAnonymised: number
  issuesRedacted: number
  notificationsDeleted: number
  searchQueriesDeleted: number
  webhookPayloadsRedacted: number
  simulatorRowsDeleted: number
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000)

export async function runRetentionPurge(now: Date = new Date()): Promise<PurgeResult> {
  const orderCutoff = new Date(now)
  orderCutoff.setUTCFullYear(orderCutoff.getUTCFullYear() - RETENTION.orderContactYears)
  return withTransaction(async (tx) => {
    const orders = await tx.query(
      `UPDATE commerce.orders SET email = 'anon-' || id || '@${ANONYMISED_DOMAIN}', pickup_name = NULL,
         arrival_note = NULL, rating_comment = NULL, user_id = NULL
       WHERE created_at < $1 AND email NOT LIKE '%@${ANONYMISED_DOMAIN}'`,
      [orderCutoff],
    )
    const issues = await tx.query(
      `UPDATE commerce.support_issues SET description = NULL
       WHERE created_at < $1 AND description IS NOT NULL`,
      [orderCutoff],
    )
    const notifications = await tx.query('DELETE FROM ops.notifications WHERE created_at < $1', [
      daysAgo(now, RETENTION.notificationDays),
    ])
    const search = await tx.query('DELETE FROM ops.search_queries WHERE created_at < $1', [
      daysAgo(now, RETENTION.searchAnalyticsDays),
    ])

    const webhooks = await tx.query(
      `UPDATE ops.webhook_events SET payload = jsonb_build_object('redacted', true, 'id', event_id, 'type', type)
       WHERE received_at < $1 AND status IN ('processed', 'ignored') AND NOT (payload ? 'redacted')`,
      [daysAgo(now, RETENTION.webhookPayloadDays)],
    )
    const simulator = await tx.query('DELETE FROM ops.payment_simulator WHERE updated_at < $1', [
      daysAgo(now, RETENTION.simulatorDays),
    ])
    return {
      ordersAnonymised: orders.rowCount ?? 0,
      issuesRedacted: issues.rowCount ?? 0,
      notificationsDeleted: notifications.rowCount ?? 0,
      searchQueriesDeleted: search.rowCount ?? 0,
      webhookPayloadsRedacted: webhooks.rowCount ?? 0,
      simulatorRowsDeleted: simulator.rowCount ?? 0,
    }
  })
}
