import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import {
  ACCT,
  APP,
  Browser,
  db,
  drainWorker,
  m,
  mail,
  orderRow,
  sendWebhook,
  sessionEvent,
  sql,
  stripe,
  setupIntegrationHarness,
} from '../setup/harness'

/**
 * G2-17: checkout → webhook → order → capture, end to end against real Postgres (as app_rw), the
 * real route handlers and the real worker loop. Stripe is replaced by an in-memory gateway that
 * behaves like test mode; webhook signatures are generated and verified with Stripe's real
 * algorithm. Also covers the G2 acceptance criteria that need a database: ledger INSERT-only
 * (G2-01), outbox exactly-once + retry/dead-letter (G2-03), idempotency (G2-04), cart (G2-06),
 * concurrent transitions (G2-09), balanced ledger (G2-10), email (G2-14), rate limits (G2-16),
 * auth-expiry guard (G2-19), guest lookup (G2-20).
 */
setupIntegrationHarness('grocery_orders_it')

// Basket: 2 × each (zero-rated) · 3 × taxable with deposit · 1.5 lb sold by weight · 2 × by quantity
const BASKET = async (b: Browser) => {
  expect((await b.add('DEMO-0002', { quantity: 2 })).status).toBe(201)
  expect((await b.add('DEMO-0157', { quantity: 3 })).status).toBe(201)
  expect((await b.add('DEMO-0006', { weightLb: 1.5 })).status).toBe(201)
  return b.add('DEMO-0001', { quantity: 2 })
}

// ---------------------------------------------------------------- the happy path
describe('checkout → webhook → order → capture (G2-17)', () => {
  const b = new Browser()
  let quoteHash = ''
  let publicId = ''
  let orderId = 0
  let sessionId = ''

  it('builds a server cart and a quote that matches the engine', async () => {
    const res = await BASKET(b)
    expect(res.status).toBe(201)
    expect(b.cookie).toMatch(/^cart=/)
    const { body } = await b.quote()
    expect(body.quote).toMatchObject({
      itemSubtotalCents: 5642, // 1878 + 1677 + 614 + 1473
      depositCents: 30,
      taxCents: 218, // 13% of 1677 = 218.01
      estimatedTotalCents: 5890,
      weighedEstimateCents: 2087,
      weightBufferCents: 313, // 15% of 2087 = 313.05
      authorizationCents: 6203,
      canCheckout: true,
    })
    expect(body.quote.fee).toBeUndefined() // commission never reaches customers
    quoteHash = body.quote.hash
  })

  it('refuses checkout without an Idempotency-Key', async () => {
    const res = await b.checkout({ quoteHash, email: 'guest@example.com' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('creates the order BEFORE redirecting, with a manual-capture destination charge', async () => {
    const res = await b.checkout({ quoteHash, email: 'guest@example.com' }, 'idem-key-0001')
    expect(res.status).toBe(201)
    publicId = res.body.publicId
    const order = await orderRow(publicId)
    orderId = Number(order.id)
    expect(order).toMatchObject({
      status: 'pending_payment',
      authorization_cents: '6203',
      fee_estimate_cents: '846',
    })

    sessionId = res.body.checkoutUrl.split('/').pop()
    const { params } = stripe.sessions.get(sessionId)!
    expect(params.metadata).toEqual({ order_id: String(orderId), public_id: publicId })
    expect(params.payment_intent_data).toMatchObject({
      capture_method: 'manual',
      on_behalf_of: ACCT,
      transfer_data: { destination: ACCT },
      application_fee_amount: 846,
    })
    expect(params.payment_method_options?.card).toEqual({
      request_overcapture: 'if_available',
      request_incremental_authorization: 'if_available',
    })
    expect(params.custom_text?.submit).toMatchObject({
      message: expect.stringMatching(/temporary hold/),
    })
    expect(m.payments.lineItemsTotal(params.line_items!)).toBe(6203)
    const names = params.line_items!.map(
      (l) => (l.price_data!.product_data as { name: string }).name,
    )
    expect(names).toContain('HST (13%)')
    expect(names).toContain('Weighed-item hold, released after weighing')
  })

  it('replays the same response for the same key, and 422 for a different body', async () => {
    const again = await b.checkout({ quoteHash, email: 'guest@example.com' }, 'idem-key-0001')
    expect(again.status).toBe(201)
    expect(again.body.publicId).toBe(publicId)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    const other = await b.checkout({ quoteHash, email: 'other@example.com' }, 'idem-key-0001')
    expect(other.status).toBe(422)
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const { rows } = await sql(db.adminUrl, 'SELECT count(*)::int AS n FROM commerce.orders')
    expect(rows[0].n).toBe(1)
  })

  it('rejects bad webhook signatures and live-mode events', async () => {
    const mod = await import(`${APP}/webhooks/stripe/route.ts`)
    const bad = await mod.POST(
      new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=deadbeef' },
        body: '{}',
      }),
      { params: Promise.resolve({}) },
    )
    expect(bad.status).toBe(400)
    const live = await sendWebhook({
      ...sessionEvent('checkout.session.completed', sessionId, orderId),
      livemode: true,
    })
    expect(live.status).toBe(400)
  })

  it('places the order from the webhook; duplicates and stale events are harmless', async () => {
    stripe.pay(sessionId)
    const event = sessionEvent('checkout.session.completed', sessionId, orderId)
    expect((await sendWebhook(event)).body).toEqual({ received: true, duplicate: false })
    expect((await sendWebhook(event)).body).toEqual({ received: true, duplicate: true })
    // An older "expired" event arriving late must not undo the placement.
    await drainWorker()
    await sendWebhook(sessionEvent('checkout.session.expired', sessionId, orderId))
    await drainWorker()

    const order = await orderRow(publicId)
    expect(order.status).toBe('placed')
    const { rows } = await sql(db.adminUrl, 'SELECT * FROM finance.payments WHERE order_id = $1', [
      orderId,
    ])
    expect(rows[0]).toMatchObject({
      status: 'requires_capture',
      amount_authorized_cents: '6203',
      overcapture_status: 'unavailable',
      incremental_authorization_status: 'available',
    })
    expect(rows[0].capture_before).toBeInstanceOf(Date)
    const cart = await sql(db.adminUrl, 'SELECT status FROM commerce.carts WHERE id = $1', [
      order.cart_id,
    ])
    expect(cart.rows[0].status).toBe('converted')
  })

  it('emails the confirmation exactly once (outbox → Mailpit)', async () => {
    const confirmations = mail.filter((x) => x.subject === `Order ${publicId} placed`)
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0].to).toBe('guest@example.com')
    expect(confirmations[0].text).toContain('temporary hold of $62.03')
  })

  it('shows the order to the guest link holder only', async () => {
    const res = await b.checkout({ quoteHash, email: 'guest@example.com' }, 'idem-key-0001')
    const token = new URL(`http://x${res.body.orderUrl}`).searchParams.get('t')!
    const ok = await b.call(
      'GET',
      'v1/orders/[publicId]',
      `/api/v1/orders/${publicId}?t=${encodeURIComponent(token)}`,
      undefined,
      {},
      { publicId },
    )
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ publicId, status: 'placed', statusLabel: 'Order placed' })
    expect(ok.body.fee).toBeUndefined()
    const noToken = await b.call(
      'GET',
      'v1/orders/[publicId]',
      `/api/v1/orders/${publicId}`,
      undefined,
      {},
      { publicId },
    )
    expect(noToken.status).toBe(404)
    const forged = await b.call(
      'GET',
      'v1/orders/[publicId]',
      `/api/v1/orders/${publicId}?t=${encodeURIComponent(token.slice(0, -2) + 'xx')}`,
      undefined,
      {},
      { publicId },
    )
    expect(forged.status).toBe(404)
  })

  it('captures the final amount after picking, with the fee on the final subtotal', async () => {
    await m.payments.fastForwardToPicked(
      orderId,
      { type: 'admin', id: '1' },
      { weightChangePercent: 10 },
    )
    await drainWorker()
    const order = await orderRow(publicId)
    expect(order).toMatchObject({
      status: 'ready',
      final_item_subtotal_cents: '5850', // bananas 1.65 lb → 675; apples 3.454 lb → 1620
      final_tax_cents: '218',
      final_deposit_cents: '30',
      final_total_cents: '6098',
      fee_final_cents: '878', // 15% of 5850 = 877.5 → 878
    })
    expect(stripe.captures).toEqual([
      {
        id: stripe.sessions.get(sessionId)!.pi,
        amounts: { amountToCaptureCents: 6098, applicationFeeCents: 878 },
        key: `capture:${orderId}`,
      },
    ])
  })

  it('writes a balanced ledger for the order', async () => {
    const ledger = await m.payments.getOrderLedger(orderId)
    const debits = ledger.reduce((s, a) => s + a.debitCents, 0)
    const credits = ledger.reduce((s, a) => s + a.creditCents, 0)
    expect(debits).toBe(credits)
    const byAccount = Object.fromEntries(
      ledger.map((a) => [a.account, a.debitCents - a.creditCents]),
    )
    const processingFee = Math.round(6098 * 0.029) + 30
    expect(byAccount).toEqual({
      'merchant_payable:1': 0, // 5220 owed, then transferred
      platform_fee_revenue: -878,
      processing_fee_expense: processingFee,
      stripe_clearing: 878 - processingFee,
    })
  })

  it('capture is idempotent: a re-run job does nothing', async () => {
    expect(await m.payments.captureOrder(orderId)).toBe('skipped')
    expect(stripe.captures).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- other paths
describe('checkout edge cases', () => {
  it('stale quote → 409 PRICE_CHANGED with the new quote', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 2 })
    const { body } = await b.quote()
    await sql(
      db.adminUrl,
      `UPDATE catalog.products SET unit_price_cents = 999 WHERE id = 'DEMO-0002'`,
    )
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'a@example.com' },
      'idem-key-stale',
    )
    await sql(
      db.adminUrl,
      `UPDATE catalog.products SET unit_price_cents = 939 WHERE id = 'DEMO-0002'`,
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PRICE_CHANGED')
    expect(res.body.error.details.quote.itemSubtotalCents).toBe(1998)
  })

  it('a quote older than 10 minutes → 409 QUOTE_EXPIRED', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 2 })
    const { body } = await b.quote()
    await sql(
      db.adminUrl,
      `UPDATE commerce.carts SET last_quoted_at = now() - interval '11 minutes'`,
    )
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'a@example.com' },
      'idem-key-expired',
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUOTE_EXPIRED')
  })

  it('below the minimum order → 422 CART_INVALID', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 1 }) // $9.39 < $15 minimum
    const { body } = await b.quote()
    expect(body.quote.issues.map((i: { code: string }) => i.code)).toEqual(['BELOW_MINIMUM'])
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'a@example.com' },
      'idem-key-minimum',
    )
    expect(res.status).toBe(422)
  })

  it('one merchant per cart: 409, or a new cart with replaceCart', async () => {
    await sql(
      db.adminUrl,
      `INSERT INTO merchant.merchants (slug, name) VALUES ('other-shop', 'Other Shop')`,
    )
    await sql(
      db.adminUrl,
      `INSERT INTO merchant.locations (merchant_id, slug, name) SELECT id, 'main', 'Main' FROM merchant.merchants WHERE slug = 'other-shop'`,
    )
    await sql(
      db.adminUrl,
      `INSERT INTO catalog.products (id, external_id, merchant_id, location_id, subcategory_id, name, unit_price_cents)
       SELECT 'OTHER-1', 'OTHER-1', m.id, l.id, (SELECT min(id) FROM catalog.subcategories), 'Other bread', 500
       FROM merchant.merchants m JOIN merchant.locations l ON l.merchant_id = m.id WHERE m.slug = 'other-shop'`,
    )
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 1 })
    const mixed = await b.add('OTHER-1', { quantity: 1 })
    expect(mixed.status).toBe(409)
    expect(mixed.body.error.code).toBe('CART_MIXED_MERCHANTS')
    const replaced = await b.add('OTHER-1', { quantity: 1 }, { replaceCart: true })
    expect(replaced.status).toBe(201)
    expect(replaced.body.cart.items.map((i: { productId: string }) => i.productId)).toEqual([
      'OTHER-1',
    ])
  })

  it('an expired checkout session abandons the order', async () => {
    const b = new Browser()
    await BASKET(b)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'late@example.com' },
      'idem-key-abandon',
    )
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    await sendWebhook(sessionEvent('checkout.session.expired', sid, Number(order.id)))
    await drainWorker()
    expect((await orderRow(res.body.publicId)).status).toBe('abandoned')
  })

  it('checkout is rate-limited per client', async () => {
    const b = new Browser()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await b.checkout(
            { quoteHash: '0'.repeat(32), email: 'x@example.com' },
            `rate-key-${i}0000`,
          )
        ).status,
      )
    expect(statuses.at(-1)).toBe(429)
    expect(statuses.slice(0, 10)).not.toContain(429)
  })
})

describe('cart merge on login (G2-06)', () => {
  it('adds anonymous lines to the customer cart, larger quantity wins', async () => {
    const user = { id: 'cust-merge', email: 'merge@example.com', roles: ['customer' as const] }
    const own = await m.cart.addItem(
      { user, cookieCartId: null },
      { productId: 'DEMO-0002', quantity: 3 },
    )
    const anon = await m.cart.addItem(
      { user: null, cookieCartId: null },
      { productId: 'DEMO-0002', quantity: 1 },
    )
    await m.cart.addItem(
      { user: null, cookieCartId: anon.cart!.id },
      { productId: 'DEMO-0157', quantity: 2 },
    )
    const merged = await m.cart.resolveCart({ user, cookieCartId: anon.cart!.id })
    expect(merged.cart!.id).toBe(own.cart!.id)
    expect(merged.setCookie).toBe('') // anonymous cookie cleared
    const items = await m.cart.getCartItems(merged.cart!.id)
    expect(items.map((i) => [i.productId, i.quantity])).toEqual([
      ['DEMO-0002', 3],
      ['DEMO-0157', 2],
    ])
  })
})

describe('order state machine under concurrency (G2-09)', () => {
  it('accept vs cancel at the same moment: exactly one wins', async () => {
    const b = new Browser()
    await BASKET(b)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'race@example.com' },
      'idem-key-race1',
    )
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    stripe.pay(sid)
    await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
    await drainWorker()

    const admin = { type: 'admin' as const, id: '1' }
    const results = await Promise.allSettled([
      m.ordering.transition(Number(order.id), 'placed', 'accepted', admin),
      m.ordering.transition(Number(order.id), 'placed', 'cancelled', admin),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason.code).toBe('ORDER_STATE_CONFLICT')
    const events = await m.ordering.getOrderEvents(Number(order.id))
    expect(events.filter((e) => e.fromStatus === 'placed')).toHaveLength(1)
  })

  it('voiding a placed order cancels the authorisation and emails the customer', async () => {
    const b = new Browser()
    await BASKET(b)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'void@example.com' },
      'idem-key-void1',
    )
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    stripe.pay(sid)
    await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
    await drainWorker()
    await m.payments.voidOrder(Number(order.id), { type: 'admin', id: '1' }, 'customer asked')
    await drainWorker()
    expect((await orderRow(res.body.publicId)).status).toBe('cancelled')
    expect(stripe.cancels).toContain(stripe.sessions.get(sid)!.pi)
    expect(mail.some((x) => x.to === 'void@example.com' && /cancelled/.test(x.subject))).toBe(true)
  })

  it('a capture that keeps failing dead-letters into payment_issue with an alert', async () => {
    const b = new Browser()
    await BASKET(b)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'fail@example.com' },
      'idem-key-fail1',
    )
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    stripe.pay(sid)
    await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
    await drainWorker()
    stripe.captureShouldFail = true
    try {
      await m.payments.fastForwardToPicked(Number(order.id), { type: 'admin', id: '1' })
      for (let i = 0; i < 6; i++) {
        await sql(db.adminUrl, `UPDATE ops.jobs SET run_at = now() WHERE status = 'queued'`)
        await drainWorker()
      }
    } finally {
      stripe.captureShouldFail = false
    }
    expect((await orderRow(res.body.publicId)).status).toBe('payment_issue')
    const alerts = await sql(db.adminUrl, `SELECT kind FROM ops.alerts WHERE dedupe_key = $1`, [
      `capture-failed:${order.id}`,
    ])
    expect(alerts.rows).toHaveLength(1)
  })
})

describe('outbox and job queue (G2-03)', () => {
  it('an outbox event is delivered exactly once per consumer', async () => {
    const { withTransaction } = await import('@/server/db')
    const eventId = await withTransaction((tx) =>
      m.ops.emit(tx, 'test.topic', 1, { hello: 'world' }),
    )
    const subs = { 'test.*': ['test.consumer-a', 'test.consumer-b'] }
    expect(await m.ops.relayOutbox(subs)).toBeGreaterThanOrEqual(1)
    expect(await m.ops.relayOutbox(subs)).toBe(0)
    const { rows } = await sql(
      db.adminUrl,
      'SELECT queue FROM ops.jobs WHERE dedupe_key = $1 ORDER BY queue',
      [eventId],
    )
    expect(rows.map((r) => r.queue)).toEqual(['test.consumer-a', 'test.consumer-b'])
    let handled = 0
    expect(await m.ops.handleOnce('test.consumer-a', eventId, async () => void handled++)).toBe(
      true,
    )
    expect(await m.ops.handleOnce('test.consumer-a', eventId, async () => void handled++)).toBe(
      false,
    )
    expect(handled).toBe(1)
  })

  it('failing jobs retry with backoff, then dead-letter', async () => {
    const id = await m.ops.enqueue(
      (await import('@/server/db')).getDb(),
      'test.flaky',
      {},
      { maxAttempts: 2 },
    )
    let [job] = await m.ops.claimJobs(['test.flaky'], 1, 'w')
    expect(job.id).toBe(id)
    expect(await m.ops.failJob(job, new Error('boom'))).toBe('retry')
    expect(await m.ops.claimJobs(['test.flaky'], 1, 'w')).toEqual([]) // not before its backoff
    await sql(db.adminUrl, `UPDATE ops.jobs SET run_at = now() WHERE id = $1`, [id])
    ;[job] = await m.ops.claimJobs(['test.flaky'], 1, 'w')
    expect(job.attempts).toBe(2)
    expect(await m.ops.failJob(job, new Error('boom again'))).toBe('dead')
    const { rows } = await sql(
      db.adminUrl,
      'SELECT status, last_error FROM ops.jobs WHERE id = $1',
      [id],
    )
    expect(rows[0]).toEqual({ status: 'dead', last_error: 'boom again' })
  })

  it('a job enqueued in a rolled-back transaction never exists', async () => {
    const { withTransaction } = await import('@/server/db')
    await expect(
      withTransaction(async (tx) => {
        await m.ops.enqueue(tx, 'test.rollback', {}, { dedupeKey: 'rb-1' })
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    const { rows } = await sql(
      db.adminUrl,
      `SELECT count(*)::int AS n FROM ops.jobs WHERE queue = 'test.rollback'`,
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('ledger and audit tables are append-only for app_rw (G2-01)', () => {
  it.each([
    'UPDATE finance.ledger_entries SET debit_cents = debit_cents',
    'DELETE FROM finance.ledger_entries',
    'UPDATE finance.ledger_journals SET event = event',
    'DELETE FROM commerce.order_events',
    'UPDATE ops.audit_log SET action = action',
  ])('%s → permission denied', async (statement) => {
    await expect(sql(db.asRole('app_rw'), statement)).rejects.toThrow(/permission denied/)
  })

  it('an unbalanced journal is rejected at commit', async () => {
    const { withTransaction } = await import('@/server/db')
    await expect(
      withTransaction(async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO finance.ledger_journals (idempotency_key, event) VALUES ('bad:1', 'test') RETURNING id`,
        )
        await tx.query(
          `INSERT INTO finance.ledger_entries (journal_id, account, debit_cents) VALUES ($1, 'stripe_clearing', 100)`,
          [rows[0].id],
        )
      }),
    ).rejects.toThrow(/unbalanced/)
  })

  it.each([
    [
      "INSERT INTO commerce.orders (public_id, merchant_id, location_id, email, item_subtotal_cents, deposit_cents, tax_cents, estimated_total_cents, weight_buffer_cents, authorization_cents, fee_schedule_id, fee_estimate_cents, quote_hash) VALUES ('SH-AAAAAA', 1, 1, 'a@b.c', -1, 0, 0, -1, 0, -1, 1, 0, 'x')",
      /check/,
    ],
    [
      "INSERT INTO commerce.orders (public_id, merchant_id, location_id, email, item_subtotal_cents, deposit_cents, tax_cents, estimated_total_cents, weight_buffer_cents, authorization_cents, fee_schedule_id, fee_estimate_cents, quote_hash) VALUES ('SH-AAAAAB', 1, 1, 'a@b.c', 100, 0, 0, 99, 0, 99, 1, 0, 'x')",
      /check/,
    ],
    ["UPDATE commerce.orders SET status = 'teleported'", /check/],
  ])('constraints reject bad money and enums: %s', async (statement, error) => {
    await expect(sql(db.adminUrl, statement)).rejects.toThrow(error)
  })
})

describe('auth-expiry guard (G2-19)', () => {
  it('alerts once, 48 h before capture_before (fake clock)', async () => {
    const b = new Browser()
    await BASKET(b)
    const { body } = await b.quote()
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'expiry@example.com' },
      'idem-key-expiry',
    )
    const order = await orderRow(res.body.publicId)
    const sid = res.body.checkoutUrl.split('/').pop()
    const captureBefore = new Date('2030-01-10T12:00:00Z')
    stripe.pay(sid, captureBefore)
    await sendWebhook(sessionEvent('checkout.session.completed', sid, Number(order.id)))
    await drainWorker()

    const payment = await sql(db.adminUrl, 'SELECT id FROM finance.payments WHERE order_id = $1', [
      order.id,
    ])
    const alerted = async () =>
      (
        await sql(db.adminUrl, 'SELECT count(*)::int AS n FROM ops.alerts WHERE dedupe_key = $1', [
          `auth-expiry:${payment.rows[0].id}`,
        ])
      ).rows[0].n
    // This run also alerts on the other test orders (their authorisations expire in ~7 days).
    await m.payments.runAuthExpiryGuard(new Date('2030-01-08T11:00:00Z')) // 49 h before
    expect(await alerted()).toBe(0)
    expect(await m.payments.runAuthExpiryGuard(new Date('2030-01-08T13:00:00Z'))).toBe(1) // 47 h
    expect(await alerted()).toBe(1)
    expect(await m.payments.runAuthExpiryGuard(new Date('2030-01-08T14:00:00Z'))).toBe(0) // once only
  })
})

describe('guest order lookup (G2-20)', () => {
  it('gives the same answer for every input and emails only the order owner', async () => {
    const { rows } = await sql(
      db.adminUrl,
      `SELECT public_id, email FROM commerce.orders WHERE status = 'ready' LIMIT 1`,
    )
    const b = new Browser()
    const before = mail.length
    const hit = await b.call('POST', 'v1/orders/lookup', '/api/v1/orders/lookup', {
      publicId: rows[0].public_id,
      email: rows[0].email,
    })
    const wrongEmail = await b.call('POST', 'v1/orders/lookup', '/api/v1/orders/lookup', {
      publicId: rows[0].public_id,
      email: 'attacker@example.com',
    })
    const noOrder = await b.call('POST', 'v1/orders/lookup', '/api/v1/orders/lookup', {
      publicId: 'SH-ZZZZZZ',
      email: rows[0].email,
    })
    expect(hit).toMatchObject({ status: 200 })
    expect(wrongEmail.body).toEqual(hit.body)
    expect(noOrder.body).toEqual(hit.body)
    expect(mail.slice(before).map((x) => x.to)).toEqual([rows[0].email])
  })
})

describe('merchant status from Connect account.updated (G2-11)', () => {
  it('updates onboarding status and capabilities from the webhook, without polling', async () => {
    const event = {
      id: 'evt_test_account_1',
      object: 'event',
      type: 'account.updated',
      livemode: false,
      account: ACCT,
      created: Math.floor(Date.now() / 1000),
      api_version: '2025-08-27.basil',
      data: {
        object: {
          id: ACCT,
          object: 'account',
          charges_enabled: false,
          payouts_enabled: false,
          requirements: { disabled_reason: 'requirements.past_due' },
        },
      },
    }
    expect((await sendWebhook(event, 'webhooks/stripe-connect')).status).toBe(200)
    await drainWorker()
    const { rows } = await sql(
      db.adminUrl,
      'SELECT onboarding_status, charges_enabled, disabled_reason FROM merchant.merchants WHERE id = 1',
    )
    expect(rows[0]).toEqual({
      onboarding_status: 'restricted',
      charges_enabled: false,
      disabled_reason: 'requirements.past_due',
    })
  })
})
