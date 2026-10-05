import type { Db } from '@/server/db'
import { getDb } from '@/server/db'
import { getLogger } from '@/server/logger'

import { routeFor } from './alertRules'
import { emit } from './outbox'

/**
 * Operational alerts (auth expiry, capture failures, dead jobs…). Stored once per dedupe key and
 * logged at error/warn level with their route (G6-09, alertRules.ts), so a log platform can page
 * on `alert.channel = "page"`; in the same transaction `ops.alert_raised` is emitted, and the
 * notifications module emails the route's channel once the alert is committed.
 */
export async function raiseAlert(
  db: Db,
  alert: {
    kind: string
    dedupeKey: string
    severity: 'info' | 'warning' | 'critical'
    message: string
    data?: Record<string, unknown>
  },
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ops.alerts (kind, dedupe_key, severity, message, data) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [alert.kind, alert.dedupeKey, alert.severity, alert.message, alert.data ?? {}],
  )
  if (!rows[0]) return false
  const route = routeFor(alert.kind)
  const id = Number(rows[0].id)
  await emit(db, 'ops.alert_raised', id, {
    alertId: id,
    kind: alert.kind,
    severity: alert.severity,
    message: alert.message,
    sev: route.sev,
    channel: route.channel,
    runbook: route.runbook,
  })
  const log = getLogger().child({
    alert: {
      id,
      kind: alert.kind,
      severity: alert.severity,
      sev: route.sev,
      channel: route.channel,
    },
  })
  if (!route.known) log.warn({ kind: alert.kind }, 'alert kind has no route in alertRules.ts')
  if (alert.severity === 'critical') log.error(alert.data ?? {}, alert.message)
  else log.warn(alert.data ?? {}, alert.message)
  return true
}

export interface AlertRow {
  id: number
  kind: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  data: Record<string, unknown>
  createdAt: Date
  resolvedAt: Date | null
}

/** Open alerts, newest first (the /ops dashboard; G6-09 routes them to a channel). */
export async function listAlerts(
  filter: { open?: boolean; limit?: number } = {},
  db: Db = getDb(),
): Promise<AlertRow[]> {
  const { rows } = await db.query(
    `SELECT id, kind, severity, message, data, created_at, resolved_at FROM ops.alerts
     WHERE ($1::boolean IS NOT TRUE OR resolved_at IS NULL) ORDER BY id DESC LIMIT $2`,
    [filter.open ?? null, filter.limit ?? 50],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    severity: r.severity,
    message: r.message,
    data: r.data,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }))
}

export async function resolveAlert(id: number, db: Db = getDb()): Promise<boolean> {
  const { rowCount } = await db.query(
    'UPDATE ops.alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL',
    [id],
  )
  return !!rowCount
}
