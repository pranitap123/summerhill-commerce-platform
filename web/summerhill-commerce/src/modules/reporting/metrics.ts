import { getDb } from '@/server/db'

/**
 * Admin metrics (G5-18, PRD §8). Each metric has a written definition, shown next to its number
 * on /ops/metrics, and is one SQL query over a period [from, to). Integration tests check the
 * numbers against hand counts on seeded orders.
 */
export const METRIC_DEFINITIONS = {
  ordersPlaced: 'Orders whose payment was authorised (placed) in the period.',
  gmvCents: 'Amount captured on payments captured in the period, before refunds.',
  refundedCents: 'Refunds that succeeded in the period.',
  conversion:
    'Checkouts started in the period that were paid (placed) ÷ all checkouts started in the period.',
  fillRate:
    'For orders packed (picked) in the period: ordered lines picked, or replaced by a substitute the customer did not reject ÷ ordered lines.',
  medianAcceptSeconds:
    'Median time from placed to accepted by the store, for orders accepted in the period.',
  medianReadySeconds:
    'Median time from placed to ready for pickup, for orders that became ready in the period.',
  pickupWaitMedianSeconds:
    'Median time from the customer’s “I’m here” to handover, for orders collected in the period after a check-in.',
  pickupWaitP90Seconds: '90th percentile of the same pickup wait.',
  pickAccuracy:
    'For orders collected in the period: 1 − (lines reported missing or wrong ÷ lines picked).',
  problemRate:
    'Orders collected in the period with at least one reported problem ÷ orders collected in the period.',
  disputeRate: 'Disputes opened in the period ÷ payments captured in the period.',
  repeatRate30d:
    'Customers (by email) whose first order was placed in the period and who placed another within 30 days ÷ those customers.',
} as const
export type MetricName = keyof typeof METRIC_DEFINITIONS

export type Metrics = Record<MetricName, number | null>

const ratio = (num: number, den: number) => (den === 0 ? null : num / den)
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function computeMetrics(period: { from: Date; to: Date }): Promise<Metrics> {
  const db = getDb()
  const p = [period.from, period.to]
  const one = async (sql: string) => (await db.query(sql, p)).rows[0]
  const [
    placed,
    gmv,
    refunded,
    conversion,
    fill,
    accept,
    ready,
    wait,
    accuracy,
    problems,
    disputes,
    repeat,
  ] = await Promise.all([
    one(`SELECT count(*)::int AS n FROM commerce.orders WHERE placed_at >= $1 AND placed_at < $2`),
    one(`SELECT COALESCE(sum(amount_captured_cents), 0) AS n FROM finance.payments
           WHERE status = 'captured' AND captured_at >= $1 AND captured_at < $2`),
    one(`SELECT COALESCE(sum(amount_cents), 0) AS n FROM finance.refunds
           WHERE status = 'succeeded' AND succeeded_at >= $1 AND succeeded_at < $2`),
    one(`SELECT count(*) FILTER (WHERE placed_at IS NOT NULL)::int AS paid, count(*)::int AS started
           FROM commerce.orders WHERE created_at >= $1 AND created_at < $2`),
    one(`SELECT count(*)::int AS ordered,
             count(*) FILTER (WHERE l.status = 'picked' OR (l.status = 'substituted' AND EXISTS (
               SELECT 1 FROM commerce.order_lines s WHERE s.substitutes_line_id = l.id
                 AND COALESCE(s.customer_decision, 'approved') <> 'rejected')))::int AS filled
           FROM commerce.order_lines l JOIN commerce.orders o ON o.id = l.order_id
           WHERE l.substitutes_line_id IS NULL AND EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.order_id = o.id
             AND e.to_status = 'picked' AND e.at >= $1 AND e.at < $2)`),
    one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM accepted_at - placed_at)) AS n
           FROM commerce.orders WHERE accepted_at >= $1 AND accepted_at < $2`),
    one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.at - o.placed_at)) AS n
           FROM commerce.order_events e JOIN commerce.orders o ON o.id = e.order_id
           WHERE e.to_status = 'ready' AND e.at >= $1 AND e.at < $2`),
    one(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM collected_at - arrived_at)) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM collected_at - arrived_at)) AS p90
           FROM commerce.orders WHERE arrived_at IS NOT NULL AND collected_at >= $1 AND collected_at < $2`),
    one(`SELECT
             (SELECT count(*) FROM commerce.order_lines l JOIN commerce.orders o ON o.id = l.order_id
              WHERE o.collected_at >= $1 AND o.collected_at < $2 AND l.status = 'picked')::int AS picked,
             (SELECT count(*) FROM commerce.support_issues i
              JOIN commerce.orders o ON o.id = i.order_id
              CROSS JOIN LATERAL jsonb_array_elements(i.lines) x
              WHERE o.collected_at >= $1 AND o.collected_at < $2 AND i.type IN ('missing', 'wrong_item'))::int AS wrong`),
    one(`SELECT count(*)::int AS collected,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM commerce.support_issues i WHERE i.order_id = o.id))::int AS with_issue
           FROM commerce.orders o WHERE collected_at >= $1 AND collected_at < $2`),
    one(`SELECT (SELECT count(*) FROM finance.disputes WHERE created_at >= $1 AND created_at < $2)::int AS disputes,
             (SELECT count(*) FROM finance.payments WHERE status = 'captured' AND captured_at >= $1 AND captured_at < $2)::int AS captured`),
    one(`WITH firsts AS (
             SELECT lower(email) AS who, min(placed_at) AS first FROM commerce.orders
             WHERE placed_at IS NOT NULL GROUP BY lower(email))
           SELECT count(*)::int AS customers,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM commerce.orders o WHERE lower(o.email) = f.who
               AND o.placed_at > f.first AND o.placed_at <= f.first + interval '30 days'))::int AS repeated
           FROM firsts f WHERE f.first >= $1 AND f.first < $2`),
  ])
  return {
    ordersPlaced: placed.n,
    gmvCents: Number(gmv.n),
    refundedCents: Number(refunded.n),
    conversion: ratio(conversion.paid, conversion.started),
    fillRate: ratio(fill.filled, fill.ordered),
    medianAcceptSeconds: n(accept.n),
    medianReadySeconds: n(ready.n),
    pickupWaitMedianSeconds: n(wait.median),
    pickupWaitP90Seconds: n(wait.p90),
    pickAccuracy: accuracy.picked === 0 ? null : 1 - accuracy.wrong / accuracy.picked,
    problemRate: ratio(problems.with_issue, problems.collected),
    disputeRate: ratio(disputes.disputes, disputes.captured),
    repeatRate30d: ratio(repeat.repeated, repeat.customers),
  }
}
