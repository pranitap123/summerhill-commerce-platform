import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import { raiseAlert } from './alerts'

export type AlertChannel = 'page' | 'ops' | 'finance'
export type Sev = 'SEV1' | 'SEV2' | 'SEV3'

export interface AlertRoute {
  sev: Sev
  channel: AlertChannel
  runbook: string
}

const rb = (file: string) => `docs/runbooks/${file}`
const RUNBOOKS = rb('README.md')
const WEBHOOKS = rb('RB-03-webhook-replay.md')
const CAPTURE = rb('RB-04-capture-failed.md')
const AUTH = rb('RB-05-auth-expiring.md')
const RECON = rb('RB-09-reconciliation-mismatch.md')
const DISPUTES = rb('RB-08-dispute.md')

export const ALERT_ROUTES: Record<string, AlertRoute> = {
  'webhook.failed': { sev: 'SEV1', channel: 'page', runbook: WEBHOOKS },
  'webhook.lagging': { sev: 'SEV1', channel: 'page', runbook: WEBHOOKS },
  'payments.card_testing': { sev: 'SEV1', channel: 'page', runbook: rb('RB-12-kill-switches.md') },
  'capture.failed': { sev: 'SEV2', channel: 'page', runbook: CAPTURE },
  'job.dead': { sev: 'SEV2', channel: 'page', runbook: RUNBOOKS },
  'payment.auth_expiring': { sev: 'SEV2', channel: 'ops', runbook: AUTH },
  'payment.authorization_canceled': { sev: 'SEV2', channel: 'ops', runbook: AUTH },
  'payment.late_authorization': { sev: 'SEV2', channel: 'ops', runbook: AUTH },

  'recon.mismatch': { sev: 'SEV2', channel: 'finance', runbook: RECON },
  'recon.failed': { sev: 'SEV2', channel: 'finance', runbook: RECON },
  'capture.shortfall': { sev: 'SEV3', channel: 'finance', runbook: CAPTURE },
  'refund.failed': { sev: 'SEV2', channel: 'finance', runbook: RUNBOOKS },
  'dispute.created': { sev: 'SEV2', channel: 'finance', runbook: DISPUTES },
  'dispute.due_soon': { sev: 'SEV2', channel: 'finance', runbook: DISPUTES },
  'dispute.lost': { sev: 'SEV3', channel: 'finance', runbook: DISPUTES },
  'payout.failed': { sev: 'SEV2', channel: 'ops', runbook: rb('RB-07-payout-failed.md') },

  'order.unaccepted': { sev: 'SEV3', channel: 'ops', runbook: RUNBOOKS },
  'slot.overbooked': { sev: 'SEV3', channel: 'ops', runbook: RUNBOOKS },
  'ingest.held': { sev: 'SEV3', channel: 'ops', runbook: rb('RB-10-ingest-held.md') },
}

export function routeFor(kind: string): AlertRoute & { known: boolean } {
  const route = ALERT_ROUTES[kind]
  return route
    ? { ...route, known: true }
    : { sev: 'SEV3', channel: 'ops', runbook: RUNBOOKS, known: false }
}

export interface AlertFinding {
  subject: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  data: Record<string, unknown>
}

export interface ConditionRule {
  kind: keyof typeof ALERT_ROUTES
  description: string
  evaluate(db: Db, now: Date): Promise<AlertFinding[]>
}

export const THRESHOLDS = {
  webhookMaxAttempts: 3,
  webhookLagMs: 5 * 60_000,
  cardTesting: {
    burstWindowMs: 10 * 60_000,
    burstDeclines: 20,
    rateWindowMs: 15 * 60_000,
    declineRate: 0.3,
    minAttempts: 10,
  },
}

export const CONDITION_RULES: ConditionRule[] = [
  {
    kind: 'webhook.lagging',
    description: `A Stripe event failed ${THRESHOLDS.webhookMaxAttempts}× or has waited over 5 minutes`,
    async evaluate(db, now) {
      const { rows } = await db.query<{ retrying: number; oldest: Date | null }>(
        `SELECT count(*) FILTER (WHERE attempts >= $1)::int AS retrying, min(received_at) AS oldest
         FROM ops.webhook_events WHERE status = 'pending'`,
        [THRESHOLDS.webhookMaxAttempts],
      )
      const { retrying, oldest } = rows[0]
      const lagMs = oldest ? now.getTime() - oldest.getTime() : 0
      if (!retrying && lagMs <= THRESHOLDS.webhookLagMs) return []
      return [
        {
          subject: 'all',
          severity: 'critical',
          message: retrying
            ? `${retrying} Stripe webhook event(s) failed ${THRESHOLDS.webhookMaxAttempts} or more times`
            : `Stripe webhooks are lagging: the oldest unprocessed event is ${Math.round(lagMs / 60_000)} min old`,
          data: { retrying, lagMs },
        },
      ]
    },
  },
  {
    kind: 'payments.card_testing',
    description:
      'Decline rate over 30% in 15 min (at least 10 attempts), or over 20 declines in 10 min',
    async evaluate(db, now) {
      const t = THRESHOLDS.cardTesting

      const { rows } = await db.query<{ burst: number; declines: number; approved: number }>(
        `SELECT
           count(*) FILTER (WHERE type = 'payment_intent.payment_failed'
                              AND received_at > $1::timestamptz - ($2::int * interval '1 millisecond'))::int AS burst,
           count(*) FILTER (WHERE type = 'payment_intent.payment_failed')::int AS declines,
           count(*) FILTER (WHERE type = 'checkout.session.completed')::int AS approved
         FROM ops.webhook_events
         WHERE received_at > $1::timestamptz - ($3::int * interval '1 millisecond') AND received_at <= $1`,
        [now, t.burstWindowMs, t.rateWindowMs],
      )
      const { burst, declines, approved } = rows[0]
      const attempts = declines + approved
      const rate = attempts ? declines / attempts : 0
      if (burst <= t.burstDeclines && !(attempts >= t.minAttempts && rate > t.declineRate))
        return []
      return [
        {
          subject: 'all',
          severity: 'critical',
          message: `Possible card testing: ${declines} declines out of ${attempts} attempts in 15 min (${Math.round(rate * 100)}%), ${burst} in the last 10 min`,
          data: { burst, declines, approved, rate },
        },
      ]
    },
  },
  {
    kind: 'ingest.held',
    description: 'A catalogue ingest run was held by the anomaly guard and awaits a decision',
    async evaluate(db) {
      const { rows } = await db.query<{ id: string; merchant_id: string; anomalies: unknown }>(
        `SELECT id, merchant_id, anomalies FROM ops.ingest_runs WHERE status = 'held' ORDER BY id`,
      )
      return rows.map((r) => ({
        subject: `run-${r.id}`,
        severity: 'warning' as const,
        message: `Catalogue ingest run #${r.id} for merchant ${r.merchant_id} is held for review`,
        data: { runId: Number(r.id), merchantId: Number(r.merchant_id), anomalies: r.anomalies },
      }))
    },
  },
]

export async function evaluateAlertRules(
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<number> {
  let raised = 0
  for (const rule of CONDITION_RULES) {
    for (const finding of await rule.evaluate(db, now)) {
      const { rows } = await db.query(
        `SELECT 1 FROM ops.alerts WHERE kind = $1 AND data->>'subject' = $2 AND resolved_at IS NULL`,
        [rule.kind, finding.subject],
      )
      if (rows.length) continue
      const created = await raiseAlert(db, {
        kind: rule.kind,
        dedupeKey: `${rule.kind}:${finding.subject}:${now.toISOString()}`,
        severity: finding.severity,
        message: finding.message,
        data: { ...finding.data, subject: finding.subject },
      })
      if (created) raised++
    }
  }
  return raised
}
