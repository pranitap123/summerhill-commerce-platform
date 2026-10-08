import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OutboundTimeoutError } from '@/server/outbound'

import {
  Browser,
  db,
  drainWorker,
  m,
  orderRow,
  sendWebhook,
  sessionEvent,
  sql,
  setupIntegrationHarness,
  stripe,
} from '../setup/harness'

setupIntegrationHarness('grocery_resilience_it')

const gateway = stripe
let loseNextCaptureAnswer = false
const original = gateway.capturePaymentIntent.bind(gateway)
const replays = new Map<string, Awaited<ReturnType<typeof original>>>()

beforeAll(() => {
  gateway.capturePaymentIntent = async (id, amounts, key) => {
    const replay = replays.get(key)
    if (replay) return replay
    const result = await original(id, amounts, key)
    replays.set(key, result)
    if (loseNextCaptureAnswer) {
      loseNextCaptureAnswer = false
      throw new OutboundTimeoutError('stripe', 10_000)
    }
    return result
  }
})
afterAll(() => {
  gateway.capturePaymentIntent = original
})

async function pickedOrder(email: string, key: string) {
  const b = new Browser()
  expect((await b.add('DEMO-0002', { quantity: 4 })).status).toBe(201)
  expect((await b.add('DEMO-0001', { quantity: 2 })).status).toBe(201)
  const { body } = await b.quote()
  const res = await b.checkout({ quoteHash: body.quote.hash, email }, key)
  const order = await orderRow(res.body.publicId)
  const sid = res.body.checkoutUrl.split('/').pop()
  gateway.pay(sid)
  await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
  await drainWorker()
  await m.payments.fastForwardToPicked(Number(order.id), { type: 'admin', id: '1' })
  return {
    id: Number(order.id),
    publicId: res.body.publicId as string,
    pi: gateway.sessions.get(sid)!.pi,
  }
}

async function captureJournals(orderId: number) {
  const { rows } = await sql(
    db.adminUrl,
    'SELECT id FROM finance.ledger_journals WHERE idempotency_key = $1',
    [`capture:${orderId}`],
  )
  return rows.length
}

describe('Stripe timeout during capture (G6-05)', () => {
  it('retries the job with the same key: one capture at Stripe, one journal, order ready', async () => {
    const order = await pickedOrder('timeout@example.com', 'idem-resilience-timeout')
    loseNextCaptureAnswer = true

    await drainWorker()
    const afterTimeout = await sql(
      db.adminUrl,
      `SELECT status, attempts, last_error FROM ops.jobs WHERE queue = 'payment.capture'
       AND payload->'event'->'payload'->>'orderId' = $1`,
      [String(order.id)],
    )
    expect(afterTimeout.rows[0]).toMatchObject({ status: 'queued', attempts: 1 })
    expect(afterTimeout.rows[0].last_error).toMatch(/did not answer/)
    expect((await orderRow(order.publicId)).status).toBe('picked')

    await sql(db.adminUrl, `UPDATE ops.jobs SET run_at = now() WHERE status = 'queued'`)
    await drainWorker()

    expect((await orderRow(order.publicId)).status).toBe('ready')
    expect(gateway.captures.filter((c) => c.id === order.pi)).toHaveLength(1)
    expect(await captureJournals(order.id)).toBe(1)
  })
})

describe('worker crash mid-capture (G6-05)', () => {
  it('a job left running by a dead worker is recovered and captures exactly once', async () => {
    const order = await pickedOrder('crash@example.com', 'idem-resilience-crash')
    await m.ops.relayOutbox(m.registry.SUBSCRIPTIONS)

    const [job] = await m.ops.claimJobs(['payment.capture'], 1, 'worker-that-dies')
    expect(job.payload.event).toMatchObject({ payload: { orderId: order.id } })
    const payment = await sql(
      db.adminUrl,
      'SELECT amount_authorized_cents FROM finance.payments WHERE order_id = $1',
      [order.id],
    )
    await gateway.capturePaymentIntent(
      order.pi,
      {
        amountToCaptureCents: Number(payment.rows[0].amount_authorized_cents),
        applicationFeeCents: 0,
      },
      `capture:${order.id}`,
    )

    await drainWorker()
    expect((await orderRow(order.publicId)).status).toBe('picked')

    expect(await m.registry.recoverStuckJobs(0)).toBeGreaterThanOrEqual(1)
    await drainWorker()

    expect((await orderRow(order.publicId)).status).toBe('ready')
    expect(gateway.captures.filter((c) => c.id === order.pi)).toHaveLength(1)
    expect(await captureJournals(order.id)).toBe(1)
    const jobs = await sql(db.adminUrl, `SELECT status FROM ops.jobs WHERE id = $1`, [job.id])
    expect(jobs.rows[0].status).toBe('completed')
  })
})

describe('runbook RB-04: retry a failed capture (G7-07)', () => {
  it('a dead capture job leaves payment_issue; the retry captures once, audited, order ready', async () => {
    const order = await pickedOrder('retry@example.com', 'idem-resilience-retry')
    let failing = true
    const wrapped = gateway.capturePaymentIntent
    gateway.capturePaymentIntent = async (id, amounts, key) => {
      if (failing) throw new Error('Stripe: account restricted')
      return wrapped(id, amounts, key)
    }
    try {
      await drainWorker()
      await sql(
        db.adminUrl,
        `UPDATE ops.jobs SET max_attempts = attempts, run_at = now()
         WHERE queue = 'payment.capture' AND status = 'queued'`,
      )
      await drainWorker()
      expect((await orderRow(order.publicId)).status).toBe('payment_issue')
      const actor = { type: 'admin' as const, id: 'cli:ops' }
      failing = false

      await expect(m.payments.retryCapture(order.id, actor, 'restriction lifted')).resolves.toBe(
        'captured',
      )
      expect((await orderRow(order.publicId)).status).toBe('ready')
      expect(gateway.captures.filter((c) => c.id === order.pi)).toHaveLength(1)
      expect(await captureJournals(order.id)).toBe(1)
      const audit = await sql(
        db.adminUrl,
        `SELECT actor_id, data FROM ops.audit_log WHERE action = 'payment.capture_retry'
         AND target_id = $1`,
        [String(order.id)],
      )
      expect(audit.rows[0]).toMatchObject({
        actor_id: 'cli:ops',
        data: { reason: 'restriction lifted' },
      })

      await expect(m.payments.retryCapture(order.id, actor, 'again')).rejects.toMatchObject({
        status: 409,
      })
      await expect(m.payments.retryCapture(999_999, actor, 'x')).rejects.toMatchObject({
        status: 404,
      })
    } finally {
      gateway.capturePaymentIntent = wrapped
    }
  })
})

describe('runbook RB-03: replay a failed webhook (G7-07)', () => {
  it('replays a failed event once; processed and unknown events are refused', async () => {
    const b = new Browser()
    expect((await b.add('DEMO-0002', { quantity: 4 })).status).toBe(201)
    expect((await b.add('DEMO-0001', { quantity: 2 })).status).toBe(201)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'replay@example.com' },
      'idem-resilience-replay',
    )
    expect(res.status).toBe(201)
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    gateway.pay(sid)
    const event = sessionEvent('checkout.session.completed', sid, Number(order.id))
    await sendWebhook(event)
    const actor = { type: 'admin' as const, id: 'cli:ops' }

    await expect(m.payments.replayWebhookEvent(String(event.id), actor)).rejects.toMatchObject({
      status: 409,
      code: 'IN_PROGRESS',
    })

    await sql(db.adminUrl, `UPDATE ops.jobs SET status = 'dead' WHERE dedupe_key = $1`, [event.id])
    await sql(db.adminUrl, `UPDATE ops.webhook_events SET status = 'failed' WHERE event_id = $1`, [
      event.id,
    ])

    await expect(m.payments.replayWebhookEvent(String(event.id), actor)).resolves.toBe('processed')
    expect((await orderRow(res.body.publicId)).status).toBe('placed')
    const audit = await sql(
      db.adminUrl,
      `SELECT data FROM ops.audit_log WHERE action = 'webhook.replay' AND target_id = $1`,
      [event.id],
    )
    expect(audit.rows[0].data).toEqual({ previousStatus: 'failed' })

    await expect(m.payments.replayWebhookEvent(String(event.id), actor)).rejects.toMatchObject({
      status: 409,
    })
    await expect(m.payments.replayWebhookEvent('evt_unknown', actor)).rejects.toMatchObject({
      status: 404,
    })
  })
})
