import { context, propagation, trace } from '@opentelemetry/api'
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startTracing } from '@/server/tracing'

import {
  Browser,
  db,
  drainWorker,
  orderRow,
  sendWebhook,
  sessionEvent,
  setupIntegrationHarness,
  sql,
  stripe,
} from '../setup/harness'

setupIntegrationHarness('grocery_tracing_it')

const exporter = new InMemorySpanExporter()
beforeAll(async () => {
  expect(await startTracing('test', exporter)).toBe(true)
})
afterAll(() => {
  trace.disable()
  propagation.disable()
  context.disable()
})

const byName = (spans: ReadableSpan[], name: string | RegExp) =>
  spans.filter((s) => (typeof name === 'string' ? s.name === name : name.test(s.name)))

describe('one checkout traced end to end', () => {
  it('checkout → webhook → order placed → confirmation email share one trace', async () => {
    const b = new Browser()
    expect((await b.add('DEMO-0002', { quantity: 4 })).status).toBe(201)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'trace@example.com' },
      'idem-trace-1',
    )
    expect(res.status).toBe(201)

    const checkoutSpan = byName(exporter.getFinishedSpans(), 'POST /api/v1/checkout')[0]
    expect(checkoutSpan).toBeDefined()
    const traceId = checkoutSpan.spanContext().traceId

    const sid = res.body.checkoutUrl.split('/').pop()
    const metadata = stripe.sessions.get(sid)!.params.metadata as Record<string, string>
    expect(metadata.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`))

    const order = await orderRow(res.body.publicId)
    const outbox = await sql(
      db.adminUrl,
      `SELECT payload FROM ops.outbox WHERE topic = 'order.pending_payment' AND key = $1`,
      [String(order.id)],
    )
    expect(outbox.rows[0].payload._trace.traceparent).toContain(traceId)

    stripe.pay(sid)
    await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
    await drainWorker()
    expect((await orderRow(res.body.publicId)).status).toBe('placed')

    const spans = exporter.getFinishedSpans().filter((s) => s.spanContext().traceId === traceId)
    const names = spans.map((s) => s.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'POST /api/v1/checkout',
        'stripe.webhook checkout.session.completed',
        'job notify.order',
      ]),
    )

    const webhook = byName(spans, 'stripe.webhook checkout.session.completed')[0]
    expect(webhook.parentSpanContext?.spanId).toBeDefined()
    const notify = byName(spans, 'job notify.order')
    expect(notify.length).toBeGreaterThanOrEqual(1)

    for (const s of spans) expect(JSON.stringify(s.attributes)).not.toContain('trace@example.com')
  })
})
