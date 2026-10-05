import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  db,
  drainWorker,
  m,
  mail,
  sendWebhook,
  sql,
  stripe,
  setupIntegrationHarness,
  stripeEvent,
} from '../setup/harness'

/**
 * G6-09: alert rules as code. Each rule fires here against real Postgres: the event rules through
 * the code that detects the failure, the condition rules through `evaluateAlertRules` (the
 * `alerts.evaluate` job). Every alert is logged with its route and emailed to its channel.
 */
setupIntegrationHarness('grocery_alerts_it')

const PAGE = 'oncall@example.com'
const OPS = 'ops@example.com'
const FINANCE = 'finance@example.com'

async function alertsOf(kind: string) {
  const { rows } = await sql(
    db.adminUrl,
    'SELECT id, severity, message, data, resolved_at FROM ops.alerts WHERE kind = $1 ORDER BY id',
    [kind],
  )
  return rows
}

/** Emails sent to `to` since `before` (mail is the harness's captured mailbox). */
const mailTo = (to: string, before: number) => mail.slice(before).filter((x) => x.to === to)
/** The subjects of those emails. */
const subjects = (to: string, before: number) => mailTo(to, before).map((x) => x.subject)

/** Stored Stripe events, `count` of them, received `minutesAgo`. */
async function insertWebhookEvent(
  type: string,
  minutesAgo: number,
  extra: { status?: string; attempts?: number; count?: number } = {},
) {
  await sql(
    db.adminUrl,
    `INSERT INTO ops.webhook_events (event_id, source, type, livemode, stripe_created_at, payload,
       status, attempts, received_at)
     SELECT 'evt_alert_' || gen_random_uuid(), 'platform', $1, false, now(), '{}', $2, $3,
            now() - ($4::int * interval '1 minute')
     FROM generate_series(1, $5)`,
    [type, extra.status ?? 'ignored', extra.attempts ?? 1, minutesAgo, extra.count ?? 1],
  )
}

const clearWebhookEvents = () =>
  sql(db.adminUrl, `DELETE FROM ops.webhook_events WHERE event_id LIKE 'evt_alert_%'`)

afterEach(async () => {
  await clearWebhookEvents()
  await sql(db.adminUrl, `UPDATE ops.alerts SET resolved_at = now() WHERE resolved_at IS NULL`)
})

describe('event rules: raised where the failure is detected', () => {
  it('webhook dead-lettered → SEV1 page, logged with its route', async () => {
    const before = mail.length
    const log = m.logger.getLogger()
    const child = vi.spyOn(log, 'child')
    try {
      await sendWebhook(stripeEvent('account.updated', { id: 'acct_x' }))
      const { rows } = await sql(
        db.adminUrl,
        `SELECT event_id FROM ops.webhook_events ORDER BY id DESC LIMIT 1`,
      )
      await m.payments.onWebhookDead(rows[0].event_id, 'handler kept throwing')
      expect(child).toHaveBeenCalledWith({
        alert: expect.objectContaining({ kind: 'webhook.failed', sev: 'SEV1', channel: 'page' }),
      })
    } finally {
      child.mockRestore()
    }
    await drainWorker()
    expect((await alertsOf('webhook.failed')).at(-1)).toMatchObject({ severity: 'critical' })
    const email = mailTo(PAGE, before).find((x) => x.subject.includes('Stripe webhook'))!
    expect(email.subject).toMatch(/^\[SEV1\] Stripe webhook evt_/)
    expect(email.text).toContain('/ops')
  })

  it('capture dead-lettered → SEV2 page', async () => {
    const before = mail.length
    await m.payments.onCaptureDead(987_654, 'card_declined')
    await drainWorker()
    expect(await alertsOf('capture.failed')).toHaveLength(1)
    expect(subjects(PAGE, before)).toContainEqual(
      expect.stringMatching(/^\[SEV2\] Capture failed permanently/),
    )
  })

  it('reconciliation mismatch → SEV2 finance', async () => {
    const before = mail.length
    stripe.balanceTxns.push({
      id: 'txn_alert_rogue',
      type: 'charge',
      sourceId: 'ch_alert_rogue',
      amountCents: 1234,
      feeCents: 66,
      created: new Date(),
    })
    try {
      const runDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(
        new Date(),
      )
      const { runReconciliation } = await import('@/modules/payouts')
      const run = await runReconciliation({ runDate, trigger: 'manual' })
      expect(run?.status).toBe('mismatches')
    } finally {
      stripe.balanceTxns = stripe.balanceTxns.filter((t) => t.id !== 'txn_alert_rogue')
    }
    await drainWorker()
    expect(await alertsOf('recon.mismatch')).toHaveLength(1)
    expect(subjects(FINANCE, before)).toContainEqual(
      expect.stringMatching(/^\[SEV2\] .*[Rr]econcil/),
    )
  })
})

describe('condition rules: the alerts.evaluate job', () => {
  it('webhooks failing 3× → one SEV1 page while open, a new one after it is resolved', async () => {
    const before = mail.length
    await insertWebhookEvent('checkout.session.completed', 1, { status: 'pending', attempts: 3 })
    expect(await m.ops.evaluateAlertRules()).toBe(1)
    expect(await m.ops.evaluateAlertRules()).toBe(0) // still open: no duplicate
    await drainWorker()
    const [alert] = await alertsOf('webhook.lagging')
    expect(alert.message).toMatch(/failed 3 or more times/)
    expect(subjects(PAGE, before).filter((x) => /failed 3 or more times/.test(x))).toHaveLength(1)

    await sql(db.adminUrl, 'UPDATE ops.alerts SET resolved_at = now() WHERE id = $1', [alert.id])
    expect(await m.ops.evaluateAlertRules()).toBe(1) // condition persists: raised again
  })

  it('webhooks lagging over 5 minutes → SEV1 page', async () => {
    await insertWebhookEvent('checkout.session.completed', 6, { status: 'pending', attempts: 0 })
    await m.ops.evaluateAlertRules()
    expect((await alertsOf('webhook.lagging')).at(-1).message).toMatch(
      /lagging: the oldest .* 6 min/,
    )
  })

  it('card testing: a burst of declines, or a high decline rate → SEV1 page', async () => {
    const t = m.ops.ALERT_THRESHOLDS.cardTesting
    // 9 attempts at 67% decline: below the sample size, no alert
    await insertWebhookEvent('payment_intent.payment_failed', 12, { count: 6 })
    await insertWebhookEvent('checkout.session.completed', 12, { count: 3 })
    expect(await m.ops.evaluateAlertRules()).toBe(0)
    // the 10th attempt makes the rate count: 6/10 declined > 30%
    await insertWebhookEvent('checkout.session.completed', 12)
    const before = mail.length
    expect(await m.ops.evaluateAlertRules()).toBe(1)
    await drainWorker()
    expect(subjects(PAGE, before)).toContainEqual(
      expect.stringMatching(/^\[SEV1\] Possible card testing: 6 declines out of 10/),
    )

    // burst: over 20 declines in 10 minutes, whatever the approvals
    await clearWebhookEvents()
    await sql(db.adminUrl, `UPDATE ops.alerts SET resolved_at = now() WHERE resolved_at IS NULL`)
    await insertWebhookEvent('checkout.session.completed', 3, { count: 200 })
    await insertWebhookEvent('payment_intent.payment_failed', 3, { count: t.burstDeclines })
    expect(await m.ops.evaluateAlertRules()).toBe(0) // exactly 20: not over
    await insertWebhookEvent('payment_intent.payment_failed', 3)
    expect(await m.ops.evaluateAlertRules()).toBe(1)
    expect((await alertsOf('payments.card_testing')).at(-1).data).toMatchObject({ burst: 21 })
  })

  it('the simulator reports a declined test card as payment_intent.payment_failed, like Stripe', async () => {
    const { simulatedGateway } = await import('@/modules/payments/simulator')
    const session = await simulatedGateway('http://localhost:3000').createCheckoutSession(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: { currency: 'cad', unit_amount: 1500, product_data: { name: 'x' } },
          },
        ],
        success_url: 'http://localhost:3000/ok',
        metadata: { order_id: '0' },
      },
      `alerts-decline-${Date.now()}`,
    )
    const outcome = await m.payments.simulateCheckout(session.id, {
      action: 'pay',
      cardNumber: '4000 0000 0000 0002',
    })
    expect(outcome).toEqual({ outcome: 'declined', message: 'Your card was declined.' })
    const { rows } = await sql(
      db.adminUrl,
      `SELECT payload FROM ops.webhook_events WHERE type = 'payment_intent.payment_failed'
       ORDER BY id DESC LIMIT 1`,
    )
    expect(rows[0].payload.data.object.last_payment_error).toMatchObject({
      decline_code: 'generic_decline',
    })
    await sql(
      db.adminUrl,
      `DELETE FROM ops.webhook_events WHERE type = 'payment_intent.payment_failed'`,
    )
  })

  it('ingest run held by the anomaly guard → SEV3 ops, one alert per run', async () => {
    const before = mail.length
    const { rows } = await sql(
      db.adminUrl,
      `INSERT INTO ops.ingest_runs (merchant_id, connector, mode, status, anomalies)
       VALUES (1, 'fixture', 'full', 'held', '[{"check":"deactivation_ratio"}]') RETURNING id`,
    )
    expect(await m.ops.evaluateAlertRules()).toBe(1)
    expect(await m.ops.evaluateAlertRules()).toBe(0)
    await drainWorker()
    expect((await alertsOf('ingest.held')).at(-1).data).toMatchObject({
      runId: Number(rows[0].id),
      subject: `run-${rows[0].id}`,
    })
    expect(subjects(OPS, before)).toContainEqual(
      expect.stringMatching(/^\[SEV3\] Catalogue ingest run #\d+/),
    )
    await sql(db.adminUrl, `UPDATE ops.ingest_runs SET status = 'rejected' WHERE id = $1`, [
      rows[0].id,
    ])
  })
})
