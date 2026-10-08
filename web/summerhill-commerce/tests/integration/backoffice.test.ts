import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { resetConfigForTests } from '@/server/config'

import {
  ACCT,
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
  stripeEvent,
  setupIntegrationHarness,
} from '../setup/harness'
import { MemoryDirectory } from '../setup/memoryDirectory'
import { REPO_ROOT } from '../setup/testDb'

vi.mock('@/modules/identity', async () => {
  const actual = await vi.importActual<typeof import('@/modules/identity')>('@/modules/identity')
  return {
    ...actual,
    getSessionUser: async (headers: Headers) => {
      const u = headers.get('x-test-user')
      return u ? JSON.parse(u) : null
    },
  }
})

setupIntegrationHarness('grocery_backoffice_it')

type Role = 'admin' | 'support' | 'finance' | 'customer'
type User = { id: string; email: string; roles: Role[]; mfaVerified: boolean; sessionId: string }
const person = (id: string, email: string, roles: Role[]): User => ({
  id,
  email,
  roles: [...roles, 'customer'],
  mfaVerified: true,
  sessionId: `sess-${id}`,
})
const ADMIN = person('1', 'admin@demo.test', ['admin'])
const ADMIN2 = person('2', 'admin2@demo.test', ['admin'])
const SUPPORT = person('3', 'support@demo.test', ['support'])
const FINANCE = person('4', 'finance@demo.test', ['finance'])
const FINANCE2 = person('5', 'finance2@demo.test', ['finance'])
const OWNER = person('101', 'owner@demo.test', [])
const PICKER = person('102', 'picker@demo.test', [])
const directory = new MemoryDirectory()
const API_DIR = path.resolve(__dirname, '../../src/app/api')

let ident: typeof import('@/modules/identity')
let payouts: typeof import('@/modules/payouts')
let support: typeof import('@/modules/support')
let privacy: typeof import('@/modules/privacy')
let reporting: typeof import('@/modules/reporting')

let keySeq = 0
const key = () => `it-key-${Date.now()}-${++keySeq}`

async function admin(
  user: User | null,
  method: string,
  route: string,
  params: Record<string, string | number> = {},
  body?: unknown,
  headers: Record<string, string> = {},
) {
  let url = `/api/admin/${route}`
  for (const [k, v] of Object.entries(params)) url = url.replace(`[${k}]`, String(v))
  return new Browser().call(
    method,
    `admin/${route.split('?')[0]}`,
    url,
    body,
    {
      'user-agent': 'integration-test',
      ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
      ...headers,
    },
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
}

async function rawCall(
  user: User,
  routeFile: string,
  urlPath: string,
  params: Record<string, string>,
) {
  const mod = await import(path.join(API_DIR, routeFile, 'route.ts'))
  const res: Response = await mod.GET(
    new NextRequest(`http://localhost${urlPath}`, {
      headers: { 'x-test-user': JSON.stringify(user) },
    }),
    { params: Promise.resolve(params) },
  )
  return { status: res.status, text: await res.text(), headers: res.headers }
}

interface Placed {
  b: Browser
  publicId: string
  orderId: number
  token: string
  email: string
}

async function place(
  items: Array<[string, { quantity?: number; weightLb?: number }]>,
  email = `shopper-${++keySeq}@example.com`,
): Promise<Placed> {
  const b = new Browser()
  for (const [id, amount] of items) expect((await b.add(id, amount)).status).toBe(201)
  const { body } = await b.quote()
  const res = await b.checkout({ quoteHash: body.quote.hash, email }, key())
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const publicId = res.body.publicId as string
  const orderId = Number((await orderRow(publicId)).id)
  const sessionId = res.body.checkoutUrl.split('/').pop()
  stripe.pay(sessionId)
  await sendWebhook(sessionEvent('checkout.session.completed', sessionId, orderId))
  await drainWorker()
  expect((await orderRow(publicId)).status).toBe('placed')
  const token = new URL(`http://x${res.body.orderUrl}`).searchParams.get('t')!
  return { b, publicId, orderId, token, email }
}

async function placeCaptured(
  items: Array<[string, { quantity?: number; weightLb?: number }]>,
  email?: string,
): Promise<Placed> {
  const o = await place(items, email)
  await m.payments.fastForwardToPicked(o.orderId, { type: 'admin', id: '1' })
  await drainWorker()
  expect((await orderRow(o.publicId)).status).toBe('ready')
  return o
}

async function collect(o: Placed): Promise<void> {
  const code = (await orderRow(o.publicId)).pickup_code
  const scope = m.fulfilment.staffScope({ ...ADMIN, id: ADMIN.id } as never, [])
  await m.fulfilment.handOver(scope, o.publicId, code, null)
  expect((await orderRow(o.publicId)).status).toBe('collected')
}

const lines = async (orderId: number) =>
  (
    await sql(
      db.adminUrl,
      'SELECT * FROM commerce.order_lines WHERE order_id = $1 ORDER BY line_no',
      [orderId],
    )
  ).rows
const payment = async (orderId: number) =>
  (await sql(db.adminUrl, 'SELECT * FROM finance.payments WHERE order_id = $1', [orderId])).rows[0]
async function ledgerBalanced(orderId: number): Promise<boolean> {
  const { rows } = await sql(
    db.adminUrl,
    'SELECT COALESCE(sum(debit_cents), 0) = COALESCE(sum(credit_cents), 0) AS ok FROM finance.ledger_entries WHERE order_id = $1',
    [orderId],
  )
  return rows[0].ok
}
async function account(orderId: number, acct: string) {
  const { rows } = await sql(
    db.adminUrl,
    `SELECT COALESCE(sum(debit_cents), 0)::int AS debit, COALESCE(sum(credit_cents), 0)::int AS credit
     FROM finance.ledger_entries WHERE order_id = $1 AND account = $2`,
    [orderId, acct],
  )
  return rows[0] as { debit: number; credit: number }
}
const alertExists = async (dedupe: string) =>
  (await sql(db.adminUrl, 'SELECT 1 FROM ops.alerts WHERE dedupe_key = $1', [dedupe])).rowCount ===
  1
const torontoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())

beforeAll(async () => {
  ident = await import('@/modules/identity')
  payouts = await import('@/modules/payouts')
  support = await import('@/modules/support')
  privacy = await import('@/modules/privacy')
  reporting = await import('@/modules/reporting')
  for (const u of [ADMIN, ADMIN2, SUPPORT, FINANCE, FINANCE2, OWNER, PICKER])
    directory.add({ id: u.id, email: u.email, roles: u.roles })
  ident.setUserDirectoryForTests(directory)
  const location = (
    await sql(db.adminUrl, 'SELECT id FROM merchant.locations WHERE merchant_id = 1')
  ).rows[0].id
  for (const [u, role] of [
    [OWNER, 'owner'],
    [PICKER, 'picker'],
  ] as const)
    await sql(
      db.adminUrl,
      `INSERT INTO merchant.staff_memberships (user_id, merchant_id, location_id, role) VALUES ($1, 1, $2, $3)`,
      [u.id, role === 'owner' ? null : location, role],
    )
})

describe('back-office roles (G5-01)', () => {
  it('each role sees its own permissions', async () => {
    const me = await admin(SUPPORT, 'GET', 'me')
    expect(me.status).toBe(200)
    expect(me.body.permissions).toContain('refunds.create')
    expect(me.body.permissions).not.toContain('payouts.manage')
    expect((await admin(FINANCE, 'GET', 'me')).body.permissions).toContain('payouts.approve')
  })
})

describe('refunds and the liability matrix (G5-04)', () => {
  let o: Placed
  let apples: number
  let water: number
  beforeAll(async () => {
    o = await placeCaptured([
      ['DEMO-0002', { quantity: 2 }],
      ['DEMO-0157', { quantity: 2 }],
    ])
    const ls = await lines(o.orderId)
    apples = Number(ls.find((l) => l.product_id === 'DEMO-0002').id)
    water = Number(ls.find((l) => l.product_id === 'DEMO-0157').id)
  })

  it('missing item → merchant: transfer reversed, commission returned, ledger balanced, customer emailed', async () => {
    const k = key()
    const body = {
      scenario: 'missing_item',
      lines: [{ lineId: apples, quantity: 1 }],
      reason: 'Customer says one apple bag was missing',
    }
    const res = await admin(SUPPORT, 'POST', 'orders/[id]/refunds', { id: o.orderId }, body, {
      'idempotency-key': k,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({
      amountCents: 939,
      liability: 'merchant',
      merchantCents: 939,
      platformCents: 0,
      status: 'succeeded',
    })
    const p = await payment(o.orderId)
    const expectedFee = m.payments.proportionalFeeRefund(
      Number(p.application_fee_cents),
      Number(p.amount_captured_cents),
      939,
    )
    expect(res.body.feeRefundCents).toBe(expectedFee)
    const call = stripe.refunds.at(-1)!
    expect(call.params).toMatchObject({
      amountCents: 939,
      reverseTransfer: true,
      refundApplicationFee: true,
    })
    expect(call.key).toBe(`refund:${res.body.id}`)

    const again = await admin(SUPPORT, 'POST', 'orders/[id]/refunds', { id: o.orderId }, body, {
      'idempotency-key': k,
    })
    expect(again.body.id).toBe(res.body.id)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(stripe.refunds.filter((r) => r.key === `refund:${res.body.id}`)).toHaveLength(1)

    expect(await ledgerBalanced(o.orderId)).toBe(true)
    expect(await account(o.orderId, 'platform_fee_revenue')).toMatchObject({ debit: expectedFee })
    expect((await account(o.orderId, 'refund_expense_platform')).debit).toBe(0)
    expect((await orderRow(o.publicId)).refund_status).toBe('partial')
    const audit = await sql(
      db.adminUrl,
      `SELECT * FROM ops.audit_log WHERE action = 'refund.create' AND target_id = $1`,
      [String(o.orderId)],
    )
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'admin',
      actor_id: '3',
      user_agent: 'integration-test',
    })
    expect(audit.rows[0].ip).toMatch(/^10\.0\./)
    await drainWorker()
    expect(mail.some((x) => x.subject === `Refund of $9.39 for order ${o.publicId}`)).toBe(true)
  })

  it('price shown wrong → platform: no reversal, a platform expense', async () => {
    const res = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: o.orderId },
      { scenario: 'price_error', amountCents: 200, reason: 'Shelf price bug on apples' },
      { 'idempotency-key': key() },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({
      liability: 'platform',
      merchantCents: 0,
      platformCents: 200,
      feeRefundCents: 0,
    })
    expect(stripe.refunds.at(-1)!.params).toMatchObject({
      reverseTransfer: false,
      refundApplicationFee: false,
    })
    expect(await account(o.orderId, 'refund_expense_platform')).toMatchObject({ debit: 200 })
    expect(await ledgerBalanced(o.orderId)).toBe(true)
  })

  it('goodwill split → refund from the platform + a partial transfer reversal', async () => {
    const reversals = stripe.reversals.length
    const res = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: o.orderId },
      {
        scenario: 'goodwill',
        amountCents: 300,
        liability: 'split',
        merchantShareCents: 100,
        reason: 'Late pickup, shared gesture',
      },
      { 'idempotency-key': key() },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({ liability: 'split', merchantCents: 100, platformCents: 200 })
    expect(stripe.reversals.slice(reversals)).toEqual([
      expect.objectContaining({ amountCents: 100 }),
    ])
    expect(res.body.stripeTransferReversalId).toBe(stripe.reversals.at(-1)!.id)
    expect(await ledgerBalanced(o.orderId)).toBe(true)
  })

  it('the matrix decides the liability, and some cases are not refundable', async () => {
    const fixed = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: o.orderId },
      {
        scenario: 'damaged',
        lines: [{ lineId: water }],
        liability: 'platform',
        reason: 'try to shift cost',
      },
      { 'idempotency-key': key() },
    )
    expect(fixed.status).toBe(422)
    expect(fixed.body.error.code).toBe('LIABILITY_FIXED')
    for (const scenario of ['no_show', 'changed_mind']) {
      const r = await admin(
        FINANCE,
        'POST',
        'orders/[id]/refunds',
        { id: o.orderId },
        { scenario, full: true, reason: 'not refundable' },
        { 'idempotency-key': key() },
      )
      expect(r.status).toBe(422)
      expect(r.body.error.code).toBe('NOT_REFUNDABLE')
    }
  })

  it('a line is never refunded twice', async () => {
    const r = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: o.orderId },
      { scenario: 'damaged', lines: [{ lineId: apples }], reason: 'both bags?' },
      { 'idempotency-key': key() },
    )
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('LINE_ALREADY_REFUNDED')
  })

  it('support is capped at $50 per order; finance is not (threat T16)', async () => {
    const big = await placeCaptured([['DEMO-0004', { quantity: 3 }]])
    const line = Number((await lines(big.orderId))[0].id)
    const first = await admin(
      SUPPORT,
      'POST',
      'orders/[id]/refunds',
      { id: big.orderId },
      {
        scenario: 'damaged',
        lines: [{ lineId: line, quantity: 2 }],
        reason: 'two bunches bruised',
      },
      { 'idempotency-key': key() },
    )
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const over = await admin(
      SUPPORT,
      'POST',
      'orders/[id]/refunds',
      { id: big.orderId },
      { scenario: 'damaged', lines: [{ lineId: line, quantity: 1 }], reason: 'third one too' },
      { 'idempotency-key': key() },
    )
    expect(over.status).toBe(403)
    expect(over.body.error).toMatchObject({
      code: 'REFUND_LIMIT',
      details: { limitCents: 5000, alreadyRefundedCents: 4198 },
    })
    const fin = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: big.orderId },
      { scenario: 'damaged', lines: [{ lineId: line, quantity: 1 }], reason: 'third one too' },
      { 'idempotency-key': key() },
    )
    expect(fin.status).toBe(201)
    expect((await orderRow(big.publicId)).refund_status).toBe('full')
  })

  it('an uncaptured order is cancelled, not refunded', async () => {
    const placed = await place([['DEMO-0002', { quantity: 2 }]])
    const r = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: placed.orderId },
      { scenario: 'goodwill', full: true, liability: 'platform', reason: 'x x x' },
      { 'idempotency-key': key() },
    )
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('NOT_CAPTURED')
    const cancelled = await admin(
      SUPPORT,
      'POST',
      'orders/[id]/cancel',
      { id: placed.orderId },
      { reason: 'Customer called to cancel' },
    )
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    expect(cancelled.body).toMatchObject({ status: 'cancelled', refund: null })
    expect(stripe.cancels).toContain(stripe.sessions.get([...stripe.sessions.keys()].at(-1)!)!.pi)
  })

  it('a provider failure leaves no money trail and says so', async () => {
    const x = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    stripe.refundShouldFail = true
    try {
      const r = await admin(
        FINANCE,
        'POST',
        'orders/[id]/refunds',
        { id: x.orderId },
        { scenario: 'goodwill', amountCents: 100, liability: 'platform', reason: 'gesture' },
        { 'idempotency-key': key() },
      )
      expect(r.status).toBe(502)
    } finally {
      stripe.refundShouldFail = false
    }
    const { rows } = await sql(
      db.adminUrl,
      'SELECT status, failure_reason FROM finance.refunds WHERE order_id = $1',
      [x.orderId],
    )
    expect(rows).toEqual([expect.objectContaining({ status: 'failed' })])
    expect((await account(x.orderId, 'refund_expense_platform')).debit).toBe(0)
  })

  it('a pending refund is finished by refund.updated; a later failure is reversed in the ledger', async () => {
    const x = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    stripe.refundsPending = true
    let refund
    try {
      refund = await admin(
        FINANCE,
        'POST',
        'orders/[id]/refunds',
        { id: x.orderId },
        { scenario: 'price_error', amountCents: 150, reason: 'bug' },
        { 'idempotency-key': key() },
      )
    } finally {
      stripe.refundsPending = false
    }
    expect(refund.body.status).toBe('pending')
    expect((await account(x.orderId, 'refund_expense_platform')).debit).toBe(0)
    const other = await admin(
      FINANCE,
      'POST',
      'orders/[id]/refunds',
      { id: x.orderId },
      { scenario: 'price_error', amountCents: 10, reason: 'bug' },
      { 'idempotency-key': key() },
    )
    expect(other.body.error.code).toBe('REFUND_IN_PROGRESS')

    await sendWebhook(
      stripeEvent('refund.updated', {
        id: refund.body.stripeRefundId,
        object: 'refund',
        status: 'succeeded',
      }),
    )
    await drainWorker()
    expect((await account(x.orderId, 'refund_expense_platform')).debit).toBe(150)

    await sendWebhook(
      stripeEvent('refund.failed', stripe.refundFails(refund.body.stripeRefundId, 150)),
    )
    await drainWorker()
    const row = (
      await sql(db.adminUrl, 'SELECT status FROM finance.refunds WHERE id = $1', [refund.body.id])
    ).rows[0]
    expect(row.status).toBe('failed')
    expect(await account(x.orderId, 'refund_expense_platform')).toEqual({ debit: 150, credit: 150 })
    expect(await ledgerBalanced(x.orderId)).toBe(true)
    expect((await orderRow(x.publicId)).refund_status).toBe('none')
    expect(await alertExists(`refund-failed:${refund.body.id}`)).toBe(true)
  })
})

describe('cancel on behalf after capture (A7)', () => {
  it('refunds in full, then cancels a ready order', async () => {
    const o = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    const r = await admin(
      FINANCE,
      'POST',
      'orders/[id]/cancel',
      { id: o.orderId },
      { reason: 'Store closed early (storm)', liability: 'merchant' },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('cancelled')
    expect(r.body.refund).toMatchObject({
      scenario: 'cancellation',
      liability: 'merchant',
      status: 'succeeded',
    })
    const row = await orderRow(o.publicId)
    expect([row.status, row.refund_status]).toEqual(['cancelled', 'full'])
    expect(await ledgerBalanced(o.orderId)).toBe(true)
  })

  it("support can't refund a whole order above their limit", async () => {
    const o = await placeCaptured([['DEMO-0004', { quantity: 3 }]])
    const r = await admin(
      SUPPORT,
      'POST',
      'orders/[id]/cancel',
      { id: o.orderId },
      { reason: 'Customer asked', liability: 'merchant' },
    )
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('REFUND_LIMIT')
    expect((await orderRow(o.publicId)).status).toBe('ready')
  })
})

describe('disputes (G5-06)', () => {
  let o: Placed
  let disputeId: number
  let dp: ReturnType<typeof stripe.dispute>
  beforeAll(async () => {
    o = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await collect(o)
    dp = stripe.dispute((await payment(o.orderId)).payment_intent_id, 'fraudulent')
    await sendWebhook(stripeEvent('charge.dispute.created', dp))
    await sendWebhook(stripeEvent('charge.dispute.created', dp))
    await drainWorker()
    disputeId = Number(
      (
        await sql(db.adminUrl, 'SELECT id FROM finance.disputes WHERE stripe_dispute_id = $1', [
          dp.id,
        ])
      ).rows[0].id,
    )
  })

  it('records the chargeback once, debits amount + fee, alerts', async () => {
    const { rows } = await sql(db.adminUrl, 'SELECT * FROM finance.disputes WHERE order_id = $1', [
      o.orderId,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'needs_response',
      reason: 'fraudulent',
      fee_cents: '1500',
    })
    expect(await account(o.orderId, 'dispute_expense')).toMatchObject({ debit: dp.amount + 1500 })
    expect(await ledgerBalanced(o.orderId)).toBe(true)
    expect(await alertExists(`dispute:${dp.id}`)).toBe(true)
  })

  it('assembles an evidence pack with the handover record', async () => {
    const r = await admin(FINANCE, 'GET', 'disputes/[id]', { id: disputeId })
    expect(r.status).toBe(200)
    expect(r.body.evidence.handover).toMatchObject({
      collected: true,
      pickupCodeVerified: true,
      handedOverBy: '1',
    })
    expect(r.body.evidence.summary).toMatch(/verified the 6-digit pickup code/)
    expect(r.body.evidence.timeline.some((e: { to: string }) => e.to === 'collected')).toBe(true)
    expect((await admin(SUPPORT, 'GET', 'disputes/[id]', { id: disputeId })).status).toBe(403)
  })

  it('submits the evidence to Stripe', async () => {
    const r = await admin(FINANCE, 'POST', 'disputes/[id]/submit', { id: disputeId })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ status: 'under_review', submittedBy: '4' })
    const sent = stripe.evidence.get(dp.id)!
    expect(sent.customer_email_address).toBe(o.email)
    expect(sent.access_activity_log).toMatch(/collected/)
    expect(
      (await admin(FINANCE, 'POST', 'disputes/[id]/submit', { id: disputeId })).body.error.code,
    ).toBe('DISPUTE_NOT_OPEN')
  })

  it('a merchant-liable loss is recovered with a transfer reversal', async () => {
    const r = await admin(
      FINANCE,
      'POST',
      'disputes/[id]/liability',
      { id: disputeId },
      { liability: 'merchant' },
      { 'idempotency-key': key() },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ liability: 'merchant', recoveredCents: dp.amount })
    expect(stripe.reversals.at(-1)).toMatchObject({ amountCents: dp.amount })

    const e = await account(o.orderId, 'dispute_expense')
    expect(e.debit - e.credit).toBe(1500)
  })

  it('a won dispute gets its funds reinstated', async () => {
    const w = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await collect(w)
    const d = stripe.dispute((await payment(w.orderId)).payment_intent_id, 'product_not_received')
    await sendWebhook(stripeEvent('charge.dispute.created', d))
    await drainWorker()
    await sendWebhook(stripeEvent('charge.dispute.closed', { ...d, status: 'won' }))
    await sendWebhook(stripeEvent('charge.dispute.funds_reinstated', stripe.reinstate(d)))
    await drainWorker()
    const row = (
      await sql(
        db.adminUrl,
        'SELECT status, reinstated_cents FROM finance.disputes WHERE stripe_dispute_id = $1',
        [d.id],
      )
    ).rows[0]
    expect(row).toEqual({ status: 'won', reinstated_cents: String(d.amount) })
    const e = await account(w.orderId, 'dispute_expense')
    expect(e.debit - e.credit).toBe(1500)
  })

  it('alerts 72 h and 24 h before evidence is due (fake clock)', async () => {
    const x = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    const d = stripe.dispute((await payment(x.orderId)).payment_intent_id)
    await sendWebhook(stripeEvent('charge.dispute.created', d))
    await drainWorker()
    const id = (
      await sql(db.adminUrl, 'SELECT id FROM finance.disputes WHERE stripe_dispute_id = $1', [d.id])
    ).rows[0].id
    const due = d.evidence_details.due_by * 1000
    expect(await m.payments.runDisputeDeadlineAlerts(new Date(due - 80 * 3600_000))).toBe(0)
    expect(
      await m.payments.runDisputeDeadlineAlerts(new Date(due - 71 * 3600_000)),
    ).toBeGreaterThanOrEqual(1)
    expect(await alertExists(`dispute-due:${id}:72`)).toBe(true)
    await m.payments.runDisputeDeadlineAlerts(new Date(due - 23 * 3600_000))
    expect(await alertExists(`dispute-due:${id}:24`)).toBe(true)
  })
})

describe('payouts (G5-07)', () => {
  beforeAll(async () => {
    stripe.accounts.get(ACCT)!.available = 3_000_000
    await sql(db.adminUrl, 'UPDATE merchant.merchants SET payouts_enabled = true WHERE id = 1')
  })

  it('a manual payout within the threshold goes straight to Stripe; payout.paid completes it', async () => {
    const r = await admin(
      FINANCE,
      'POST',
      'merchants/[id]/payout',
      { id: 1 },
      { amountCents: 10_000, reason: 'Weekly payout' },
      { 'idempotency-key': key() },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ status: 'pending', method: 'manual', requestedBy: '4' })
    expect(stripe.accounts.get(ACCT)!.available).toBe(2_990_000)
    const po = stripe.payouts.at(-1)!
    await sendWebhook(
      stripeEvent(
        'payout.paid',
        {
          id: po.id,
          object: 'payout',
          amount: 10_000,
          status: 'paid',
          arrival_date: Math.floor(Date.now() / 1000),
          metadata: { payout_id: String(r.body.id) },
          automatic: false,
        },
        ACCT,
      ),
      'webhooks/stripe-connect',
    )
    await drainWorker()
    expect(
      (await sql(db.adminUrl, 'SELECT status FROM finance.payouts WHERE id = $1', [r.body.id]))
        .rows[0].status,
    ).toBe('paid')
  })

  it('above $5,000 a second person must approve; never the requester (four eyes)', async () => {
    const r = await admin(
      FINANCE,
      'POST',
      'merchants/[id]/payout',
      { id: 1 },
      { amountCents: 600_000, reason: 'Month end' },
      { 'idempotency-key': key() },
    )
    expect(r.body.status).toBe('pending_approval')
    const self = await admin(
      FINANCE,
      'POST',
      'payouts/[id]/decision',
      { id: r.body.id },
      { decision: 'approve' },
      { 'idempotency-key': key() },
    )
    expect(self.status).toBe(403)
    expect(self.body.error.code).toBe('SELF_APPROVAL')
    await expect(
      sql(db.adminUrl, `UPDATE finance.payouts SET approved_by = requested_by WHERE id = $1`, [
        r.body.id,
      ]),
    ).rejects.toThrow(/check/)
    const ok = await admin(
      FINANCE2,
      'POST',
      'payouts/[id]/decision',
      { id: r.body.id },
      { decision: 'approve' },
      { 'idempotency-key': key() },
    )
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ approvedBy: '5', status: 'pending' })
    expect(stripe.payouts.at(-1)!.amountCents).toBe(600_000)
  })

  it('can be rejected, and refuses more than the balance', async () => {
    const r = await admin(
      FINANCE,
      'POST',
      'merchants/[id]/payout',
      { id: 1 },
      { amountCents: 500_001, reason: 'Oops' },
      { 'idempotency-key': key() },
    )
    const no = await admin(
      ADMIN,
      'POST',
      'payouts/[id]/decision',
      { id: r.body.id },
      { decision: 'reject' },
      { 'idempotency-key': key() },
    )
    expect(no.body.status).toBe('rejected')
    const big = await admin(
      FINANCE,
      'POST',
      'merchants/[id]/payout',
      { id: 1 },
      { amountCents: 9_000_000, reason: 'Too much' },
      { 'idempotency-key': key() },
    )
    expect(big.status).toBe(422)
    expect(big.body.error.code).toBe('INSUFFICIENT_BALANCE')
    const noKey = await admin(
      FINANCE,
      'POST',
      'merchants/[id]/payout',
      { id: 1 },
      { amountCents: 100, reason: 'No key' },
    )
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('automatic payouts appear from webhooks; a failure alerts ops', async () => {
    await sendWebhook(
      stripeEvent(
        'payout.failed',
        {
          id: 'po_auto_1',
          object: 'payout',
          amount: 2_500,
          status: 'failed',
          arrival_date: null,
          metadata: {},
          automatic: true,
          failure_code: 'account_closed',
          failure_message: 'The bank account has been closed',
        },
        ACCT,
      ),
      'webhooks/stripe-connect',
    )
    await drainWorker()
    const row = (
      await sql(
        db.adminUrl,
        `SELECT method, status, failure_code FROM finance.payouts WHERE stripe_payout_id = 'po_auto_1'`,
      )
    ).rows[0]
    expect(row).toEqual({ method: 'automatic', status: 'failed', failure_code: 'account_closed' })
    expect(await alertExists('payout-failed:po_auto_1')).toBe(true)
  })
})

describe('merchant onboarding and lifecycle (G5-02)', () => {
  let id: number
  afterAll(() => {
    delete process.env.CONNECT_ACCOUNT_TYPE
    resetConfigForTests()
  })
  it('creates a hidden draft merchant', async () => {
    const r = await admin(
      ADMIN,
      'POST',
      'merchants',
      {},
      {
        slug: 'north-market',
        name: 'North Market',
        location: { slug: 'main', name: 'North Market Main', city: 'Toronto', province: 'ON' },
      },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    id = r.body.merchant.id
    expect(r.body.merchant).toMatchObject({
      lifecycle_status: 'draft',
      storefront_visible: false,
      accepting_orders: false,
    })
    expect(
      (
        await admin(
          ADMIN,
          'POST',
          'merchants',
          {},
          { slug: 'north-market', name: 'Dup', location: { slug: 'main', name: 'x x' } },
        )
      ).body.error.code,
    ).toBe('SLUG_TAKEN')
  })

  it('onboards a Custom account by default: terms recorded, status read at once (ADR-0012)', async () => {
    const custom = await admin(
      ADMIN,
      'POST',
      'merchants',
      {},
      {
        slug: 'custom-market',
        name: 'Custom Market',
        location: { slug: 'main', name: 'Custom Market Main', city: 'Toronto', province: 'ON' },
      },
    )
    const customId = custom.body.merchant.id
    const r = await admin(ADMIN, 'POST', 'merchants/[id]/onboarding-link', { id: customId })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.url).toMatch(/\/ops\/merchants\/\d+\?onboarding=done$/)
    expect(stripe.customAccountRequests).toHaveLength(1)
    const again = await admin(ADMIN, 'POST', 'merchants/[id]/onboarding-link', { id: customId })
    expect(again.body.accountId).toBe(r.body.accountId)
    expect(stripe.customAccountRequests).toHaveLength(1)
    expect(
      (await admin(SUPPORT, 'GET', 'merchants/[id]', { id: customId })).body.merchant,
    ).toMatchObject({
      stripe_account_type: 'custom',
      onboarding_status: 'verified',
      charges_enabled: true,
    })
  })

  it('onboards through a Stripe-hosted Express link when CONNECT_ACCOUNT_TYPE=express', async () => {
    process.env.CONNECT_ACCOUNT_TYPE = 'express'
    resetConfigForTests()
    const r = await admin(ADMIN, 'POST', 'merchants/[id]/onboarding-link', { id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.url).toMatch(/^https:\/\/connect\.stripe\.test\//)
    const again = await admin(ADMIN, 'POST', 'merchants/[id]/onboarding-link', { id })
    expect(again.body.accountId).toBe(r.body.accountId)
    const blocked = await admin(
      ADMIN,
      'POST',
      'merchants/[id]/lifecycle',
      { id },
      { action: 'go_live' },
    )
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.details.blockers).toHaveLength(2)

    stripe.completeOnboarding(r.body.accountId)
    await sendWebhook(
      stripeEvent(
        'account.updated',
        {
          id: r.body.accountId,
          object: 'account',
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { currently_due: [], disabled_reason: null },
        },
        r.body.accountId,
      ),
      'webhooks/stripe-connect',
    )
    await drainWorker()
    const merchant = (await admin(SUPPORT, 'GET', 'merchants/[id]', { id })).body.merchant
    expect(merchant).toMatchObject({
      onboarding_status: 'verified',
      charges_enabled: true,
      stripe_account_type: 'express',
    })
    const still = await admin(
      ADMIN,
      'POST',
      'merchants/[id]/lifecycle',
      { id },
      { action: 'go_live' },
    )
    expect(still.body.error.details.blockers).toEqual([
      'No published catalogue (run and approve an ingest first)',
    ])
    expect(
      (await admin(SUPPORT, 'POST', 'merchants/[id]/lifecycle', { id }, { action: 'pause' }))
        .status,
    ).toBe(403)
  })

  it('offboards: no new orders, final payout of the whole balance, offboarded', async () => {
    const acct = (
      await sql(db.adminUrl, 'SELECT stripe_account_id FROM merchant.merchants WHERE id = $1', [id])
    ).rows[0].stripe_account_id
    stripe.accounts.get(acct)!.available = 1234
    expect(
      (
        await admin(
          ADMIN,
          'POST',
          'merchants/[id]/lifecycle',
          { id },
          { action: 'finish_offboarding' },
        )
      ).body.error.code,
    ).toBe('LIFECYCLE_CONFLICT')
    expect(
      (
        await admin(
          ADMIN,
          'POST',
          'merchants/[id]/lifecycle',
          { id },
          { action: 'offboard', reason: 'Closing the business' },
        )
      ).status,
    ).toBe(200)
    const done = await admin(
      ADMIN,
      'POST',
      'merchants/[id]/lifecycle',
      { id },
      { action: 'finish_offboarding' },
    )
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect(done.body.status).toBe('offboarded')
    expect(done.body.payout).toMatchObject({
      amountCents: 1234,
      reason: 'Final payout (offboarding)',
    })
    expect(stripe.accounts.get(acct)!.available).toBe(0)
  })

  it('pausing the demo store stops new checkouts; resuming reopens it', async () => {
    expect(
      (
        await admin(
          ADMIN,
          'POST',
          'merchants/[id]/lifecycle',
          { id: 1 },
          { action: 'pause', reason: 'Inventory count' },
        )
      ).status,
    ).toBe(200)
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 2 })
    const { body } = await b.quote()
    const r = await b.checkout({ quoteHash: body.quote.hash, email: 'paused@example.com' }, key())
    expect(r.body.error.code).toBe('MERCHANT_PAUSED')
    expect(
      (await admin(ADMIN, 'POST', 'merchants/[id]/lifecycle', { id: 1 }, { action: 'resume' })).body
        .merchant.lifecycle_status,
    ).toBe('live')
  })

  it('offboarding waits for open orders', async () => {
    await place([['DEMO-0002', { quantity: 2 }]])
    await admin(
      ADMIN,
      'POST',
      'merchants/[id]/lifecycle',
      { id: 1 },
      { action: 'offboard', reason: 'test' },
    )
    const r = await admin(
      ADMIN,
      'POST',
      'merchants/[id]/lifecycle',
      { id: 1 },
      { action: 'finish_offboarding' },
    )
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('OPEN_ORDERS')

    await sql(
      db.adminUrl,
      `UPDATE merchant.merchants SET lifecycle_status = 'live', accepting_orders = true, storefront_visible = true WHERE id = 1`,
    )
  })
})

describe('support issues (G5-11)', () => {
  let o: Placed
  let apples: number
  let water: number
  beforeAll(async () => {
    o = await placeCaptured([
      ['DEMO-0002', { quantity: 2 }],
      ['DEMO-0157', { quantity: 2 }],
    ])
    await collect(o)
    const ls = await lines(o.orderId)
    apples = Number(ls.find((l) => l.product_id === 'DEMO-0002').id)
    water = Number(ls.find((l) => l.product_id === 'DEMO-0157').id)
  })
  const report = (x: Placed, body: unknown) =>
    x.b.call(
      'POST',
      'v1/orders/[publicId]/issues',
      `/api/v1/orders/${x.publicId}/issues?t=${encodeURIComponent(x.token)}`,
      body,
      {},
      { publicId: x.publicId },
    )

  it('small claims are refunded automatically, with the matrix liability', async () => {
    const r = await report(o, {
      type: 'missing',
      lines: [{ lineId: apples, quantity: 1 }],
      description: 'One bag missing',
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ status: 'auto_approved', refunded: true, claimedCents: 939 })
    const refund = (
      await sql(db.adminUrl, 'SELECT * FROM finance.refunds WHERE issue_id = $1', [r.body.issueId])
    ).rows[0]
    expect(refund).toMatchObject({
      scenario: 'missing_item',
      liability: 'merchant',
      source: 'support_issue',
      created_by: 'support-policy',
      status: 'succeeded',
    })
    const second = await report(o, {
      type: 'damaged',
      lines: [{ lineId: water }],
      description: 'Can dented and leaking',
    })
    expect(second.body.status).toBe('auto_approved')
  })

  it('over the 90-day limit the issue waits for an agent, who approves it', async () => {
    const r = await report(o, {
      type: 'wrong_item',
      lines: [{ lineId: apples, quantity: 1 }],
      description: 'Wrong apples in the other bag',
    })
    expect(r.body).toMatchObject({ status: 'open', refunded: false })
    expect(
      (await report(o, { type: 'other', lines: [], description: 'again' })).body.error.code,
    ).toBe('ISSUE_ALREADY_OPEN')
    const view = await admin(SUPPORT, 'GET', 'issues/[id]', { id: r.body.issueId })
    expect(view.body.customer90DayRefundCents).toBe(939 + 1283)
    expect(view.body.issue.decision.reasons.join()).toMatch(/90-day refunds/)
    const ok = await admin(
      SUPPORT,
      'POST',
      'issues/[id]/resolve',
      { id: r.body.issueId },
      { decision: 'approve', note: 'Photo confirms wrong variety' },
      { 'idempotency-key': key() },
    )
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', liability: 'merchant', resolvedBy: '3' })
  })

  it('an agent can reject; the customer is told why', async () => {
    const x = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await collect(x)
    const r = await report(x, { type: 'other', lines: [], description: 'Did not like them' })
    expect(r.body.status).toBe('open')
    const no = await admin(
      SUPPORT,
      'POST',
      'issues/[id]/resolve',
      { id: r.body.issueId },
      { decision: 'reject', note: 'Taste preferences are not covered by our refund policy.' },
      { 'idempotency-key': key() },
    )
    expect(no.body).toMatchObject({ status: 'rejected', liability: 'customer' })
    await drainWorker()
    expect(
      mail.some(
        (e) =>
          e.subject === `About the problem you reported on order ${x.publicId}` &&
          e.text.includes('not covered'),
      ),
    ).toBe(true)
  })

  it('reports close 48 h after pickup, and the kill switch sends everything to agents', async () => {
    const x = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await collect(x)
    const order = (await m.ordering.getOrder(x.orderId))!
    await expect(
      support.reportIssue(
        order,
        { type: 'missing', lines: [], description: null },
        { actor: { type: 'customer', id: null } },
        new Date(Date.now() + 49 * 3600_000),
      ),
    ).rejects.toMatchObject({ code: 'ISSUE_WINDOW_CLOSED' })
    await admin(ADMIN, 'PUT', 'flags/[key]', { key: 'support.auto_refund' }, { enabled: false })
    try {
      const line = Number((await lines(x.orderId))[0].id)
      const r = await report(x, {
        type: 'missing',
        lines: [{ lineId: line, quantity: 1 }],
        description: 'missing',
      })
      expect(r.body.status).toBe('open')
    } finally {
      await admin(ADMIN, 'PUT', 'flags/[key]', { key: 'support.auto_refund' }, { enabled: true })
    }
  })
})

describe('reconciliation (G5-05)', () => {
  const run = async () => {
    const r = await admin(FINANCE, 'POST', 'reconciliation', {}, { runDate: torontoToday() })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    return (await admin(FINANCE, 'GET', 'reconciliation/[id]', { id: r.body.id })).body
  }

  it('a clean day reconciles to the cent; a Stripe fee learned late is posted', async () => {
    stripe.lateFees = true
    let late: Placed
    try {
      late = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    } finally {
      stripe.lateFees = false
    }
    expect((await payment(late.orderId)).processing_fee_cents).toBeNull()
    const result = await run()
    expect(result.error).toBeNull()
    expect(result.items).toEqual([])
    expect(result.status).toBe('clean')
    expect(result.matched).toBeGreaterThan(10)
    expect(Number((await payment(late.orderId)).processing_fee_cents)).toBeGreaterThan(0)
    expect(await account(late.orderId, 'processing_fee_expense')).toMatchObject({
      debit: Number((await payment(late.orderId)).processing_fee_cents),
    })
  })

  it('catches an injected mismatch (seeded fault)', async () => {
    const victim = (
      await sql(
        db.adminUrl,
        `SELECT order_id FROM finance.payments WHERE status = 'captured' ORDER BY id LIMIT 1`,
      )
    ).rows[0].order_id
    await sql(
      db.adminUrl,
      'UPDATE finance.payments SET amount_captured_cents = amount_captured_cents + 1 WHERE order_id = $1',
      [victim],
    )
    stripe.balanceTxns.push({
      id: 'txn_rogue',
      type: 'charge',
      sourceId: 'ch_rogue',
      amountCents: 999,
      feeCents: 59,
      created: new Date(),
    })
    try {
      const result = await run()
      expect(result.status).toBe('mismatches')
      const found = result.items.map(
        (i: { kind: string; checkName: string }) => `${i.kind}:${i.checkName}`,
      )
      expect(found).toEqual(
        expect.arrayContaining([
          'amount_mismatch:charge_amount',
          'invariant:capture_split',
          'invariant:lines_total',
          'unmatched_stripe:charge',
        ]),
      )
      expect(
        result.items.find((i: { checkName: string }) => i.checkName === 'charge_amount').orderId,
      ).toBe(Number(victim))
      expect(await alertExists(`recon:${result.id}`)).toBe(true)
    } finally {
      await sql(
        db.adminUrl,
        'UPDATE finance.payments SET amount_captured_cents = amount_captured_cents - 1 WHERE order_id = $1',
        [victim],
      )
      stripe.balanceTxns = stripe.balanceTxns.filter((t) => t.id !== 'txn_rogue')
    }
    expect((await run()).status).toBe('clean')
  })

  it('the scheduled run happens once a day, after 06:00 Toronto', async () => {
    const now = new Date('2030-01-15T17:00:00Z')
    const first = await payouts.runScheduledReconciliation(now)
    expect(first?.trigger).toBe('schedule')
    expect(await payouts.runScheduledReconciliation(now)).toBeNull()
  })

  it('exports the month for the accounting close', async () => {
    const month = torontoToday().slice(0, 7)
    const r = await rawCall(
      FINANCE,
      'admin/reconciliation/close/[month]',
      `/api/admin/reconciliation/close/${month}`,
      { month },
    )
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/csv/)
    expect(r.text.split('\r\n')[0]).toBe(
      'date,journal,event,order,account,debit,credit,stripe_reference',
    )
    expect(r.text).toMatch(/capture:\d+,capture,SH-/)
  })
})

describe('statements (G5-08) and the owner finance view (G5-13)', () => {
  it('the monthly statement matches the ledger and the money tables', async () => {
    const month = torontoToday().slice(0, 7)
    const s = await payouts.merchantStatement(1, month)
    const q = async (text: string) => Number((await sql(db.adminUrl, text)).rows[0].v)
    const captured = await q(
      `SELECT COALESCE(sum(p.amount_captured_cents), 0) AS v FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id WHERE o.merchant_id = 1 AND p.status = 'captured'`,
    )
    const fees = await q(
      `SELECT COALESCE(sum(p.application_fee_cents), 0) AS v FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id WHERE o.merchant_id = 1 AND p.status = 'captured'`,
    )
    const merchantRefunds = await q(
      `SELECT COALESCE(sum(merchant_cents), 0) AS v FROM finance.refunds WHERE status = 'succeeded'`,
    )
    const feeBack = await q(
      `SELECT COALESCE(sum(fee_refund_cents), 0) AS v FROM finance.refunds WHERE status = 'succeeded'`,
    )
    const recovered = await q(`SELECT COALESCE(sum(recovered_cents), 0) AS v FROM finance.disputes`)
    const platformRefunds = await q(
      `SELECT COALESCE(sum(platform_cents), 0) AS v FROM finance.refunds WHERE status = 'succeeded'`,
    )
    expect(s.salesCents).toBe(captured)
    expect(s.commissionCents + s.hstOnCommissionCents).toBe(fees)
    expect(s.merchantRefundCents).toBe(merchantRefunds)
    expect(s.commissionReturnedCents).toBe(feeBack)
    expect(s.platformRefundCents).toBe(platformRefunds)
    expect(s.disputeRecoveryCents).toBe(recovered)
    expect(s.netTransferCents).toBe(captured - fees - merchantRefunds + feeBack - recovered)
  })

  it('downloads as CSV', async () => {
    const month = torontoToday().slice(0, 7)
    const r = await rawCall(
      FINANCE,
      'admin/merchants/[id]/statements/[month]',
      `/api/admin/merchants/1/statements/${month}?format=csv`,
      { id: '1', month },
    )
    expect(r.status).toBe(200)
    expect(r.text).toMatch(/^# Demo Market statement/)
    expect(r.text).toMatch(/\r\ntotal,/)
  })

  it('the store owner sees the same figures; pickers and other stores do not', async () => {
    const month = torontoToday().slice(0, 7)
    const call = (u: User, id: number) =>
      new Browser().call(
        'GET',
        'console/merchants/[id]/finance',
        `/api/console/merchants/${id}/finance?month=${month}`,
        undefined,
        { 'x-test-user': JSON.stringify(u) },
        { id: String(id) },
      )
    const owner = await call(OWNER, 1)
    expect(owner.status, JSON.stringify(owner.body)).toBe(200)
    expect(owner.body.statement.netTransferCents).toBe(
      (await payouts.merchantStatement(1, month)).netTransferCents,
    )
    expect((await call(PICKER, 1)).status).toBe(403)
    expect((await call(OWNER, 999)).status).toBe(404)
  })
})

describe('staff MFA (G5-12)', () => {
  it('enrols, confirms with the first code, refuses replays and re-enrolment', async () => {
    const { secret } = await ident.beginEnrolment('701', 'new.staff@demo.test')
    await expect(ident.verifyMfaCode('701', '000000')).rejects.toMatchObject({
      code: 'MFA_CODE_INVALID',
    })
    const code = ident.totp(secret)
    await ident.verifyMfaCode('701', code)
    expect(await ident.getMfaStatus('701')).toEqual({ enrolled: true, confirmed: true })
    await expect(ident.verifyMfaCode('701', code)).rejects.toMatchObject({
      code: 'MFA_CODE_INVALID',
    })
    await expect(ident.beginEnrolment('701', 'x')).rejects.toMatchObject({
      code: 'MFA_ALREADY_ENROLLED',
    })
    const stored = (
      await sql(db.adminUrl, `SELECT secret_encrypted FROM ops.staff_mfa WHERE user_id = '701'`)
    ).rows[0].secret_encrypted
    expect(stored).not.toContain(secret)
  })

  it('rate-limits guessing (5 per 5 minutes)', async () => {
    await ident.beginEnrolment('702', 'guess@demo.test')
    for (let i = 0; i < 5; i++)
      await expect(ident.verifyMfaCode('702', '111111')).rejects.toMatchObject({
        code: 'MFA_CODE_INVALID',
      })
    await expect(ident.verifyMfaCode('702', '111111')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('verifying marks the session with a cookie bound to it', async () => {
    const secret = ident.generateTotpSecret()
    const { withTransaction } = await import('@/server/db')
    await withTransaction((tx) => ident.enrolWithSecret(tx, '703', secret))
    const user = { ...person('703', 'verify@demo.test', ['support']), mfaVerified: false }
    const r = await new Browser().call(
      'POST',
      'v1/me/mfa/verify',
      '/api/v1/me/mfa/verify',
      { code: ident.totp(secret) },
      { 'x-test-user': JSON.stringify(user) },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const cookie = r.headers.get('set-cookie')!
    expect(cookie).toMatch(/^mfa=.+HttpOnly/i)
    const value = decodeURIComponent(cookie.split(';')[0].slice('mfa='.length))
    expect(ident.isMfaCookieValid(value, '703', user.sessionId)).toBe(true)
    expect(ident.isMfaCookieValid(value, '703', 'another-session')).toBe(false)
  })
})

describe('user and role management (G5-15)', () => {
  it('invites with a password-setup email; roles change with before/after in the audit log', async () => {
    const r = await admin(
      ADMIN,
      'POST',
      'users',
      {},
      {
        email: 'New.Agent@Example.com',
        name: 'New Agent',
        roles: ['support'],
        membership: { merchantId: 1, locationId: null, role: 'picker' },
      },
    )
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.user).toMatchObject({
      email: 'new.agent@example.com',
      roles: ['customer', 'support'],
    })
    expect(directory.passwordSetupEmails).toContain('new.agent@example.com')
    const id = r.body.user.id
    const team = await admin(ADMIN, 'GET', 'users')
    expect(team.body.users.find((u: { id: string }) => u.id === id).memberships).toEqual([
      expect.objectContaining({ role: 'picker', active: true }),
    ])
    const changed = await admin(ADMIN, 'PUT', 'users/[id]/roles', { id }, { roles: ['finance'] })
    expect(changed.body.user.roles).toEqual(['customer', 'finance'])
    const audit = (
      await sql(
        db.adminUrl,
        `SELECT data FROM ops.audit_log WHERE action = 'user.roles' AND target_id = $1`,
        [id],
      )
    ).rows[0]
    expect(audit.data).toEqual({
      before: { roles: ['customer', 'support'] },
      after: { roles: ['customer', 'finance'] },
    })
  })

  it('nobody changes their own roles or deactivates themselves; the last admin stays', async () => {
    expect(
      (await admin(ADMIN, 'PUT', 'users/[id]/roles', { id: '1' }, { roles: [] })).body.error.code,
    ).toBe('SELF_CHANGE')
    expect((await admin(ADMIN, 'POST', 'users/[id]/deactivate', { id: '1' })).body.error.code).toBe(
      'SELF_CHANGE',
    )
    await ident.deactivateUser({ actor: { type: 'admin', id: '1' } }, '2')
    await expect(
      ident.changeRoles({ actor: { type: 'system', id: 'test' } }, '1', ['support']),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    await ident.reactivateUser({ actor: { type: 'admin', id: '1' } }, '2')
  })

  it('deactivation ends sessions at once and removes store access', async () => {
    const r = await admin(ADMIN, 'POST', 'users/[id]/deactivate', { id: PICKER.id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.user.deactivatedAt).not.toBeNull()
    expect(directory.endedSessions).toContain(PICKER.id)
    const m1 = (
      await sql(db.adminUrl, 'SELECT active FROM merchant.staff_memberships WHERE user_id = $1', [
        PICKER.id,
      ])
    ).rows
    expect(m1).toEqual([{ active: false }])
    await ident.beginEnrolment(PICKER.id, PICKER.email)
    expect((await admin(ADMIN, 'POST', 'users/[id]/reset-mfa', { id: PICKER.id })).body).toEqual({
      reset: true,
    })
    expect(await ident.getMfaStatus(PICKER.id)).toEqual({ enrolled: false, confirmed: false })
  })
})

describe('flags (G5-10) and the audit trail (G5-09)', () => {
  it('checkout off → refused at once and shown by /api/v1/status', async () => {
    const off = await admin(
      ADMIN,
      'PUT',
      'flags/[key]',
      { key: 'checkout.enabled' },
      { enabled: false },
    )
    expect(off.body.flag).toMatchObject({ enabled: false, updatedBy: '1' })
    try {
      const status = await new Browser().call('GET', 'v1/status', '/api/v1/status')
      expect(status.body).toEqual({ checkoutEnabled: false })
      const b = new Browser()
      await b.add('DEMO-0002', { quantity: 2 })
      const { body } = await b.quote()
      expect(
        (await b.checkout({ quoteHash: body.quote.hash, email: 'off@example.com' }, key())).body
          .error.code,
      ).toBe('CHECKOUT_DISABLED')
    } finally {
      await admin(ADMIN, 'PUT', 'flags/[key]', { key: 'checkout.enabled' }, { enabled: true })
    }
    const flagged = await admin(FINANCE, 'GET', 'audit?action=flag.&targetId=checkout.enabled')
    expect(flagged.status).toBe(200)
    expect(flagged.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'flag.set',
      'flag.set',
    ])
    expect((await admin(SUPPORT, 'GET', 'audit')).status).toBe(403)
    const { rows } = await sql(
      db.adminUrl,
      `SELECT data, ip FROM ops.audit_log WHERE action = 'flag.set' AND target_id = 'checkout.enabled' ORDER BY id`,
    )
    expect(rows.map((r) => r.data)).toEqual(
      expect.arrayContaining([
        { before: true, after: false },
        { before: false, after: true },
      ]),
    )
    expect(rows[0].ip).not.toBeNull()
  })

  it('a mutation whose handler records nothing still gets a generic audit entry', async () => {
    await admin(ADMIN, 'POST', 'merchants/[id]/refresh-status', { id: 1 })
    const { rows } = await sql(
      db.adminUrl,
      `SELECT data FROM ops.audit_log WHERE action = 'api.post' AND target_id = '/api/admin/merchants/1/refresh-status'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].data).toMatchObject({ status: 200, params: { id: '1' } })
  })

  it('the viewer filters by actor, action and target', async () => {
    const all = await sql(
      db.adminUrl,
      `SELECT count(*)::int AS n FROM ops.audit_log WHERE actor_id = '4'`,
    )
    const mine = await m.ops.searchAuditLog({ actorId: '4', limit: 500 })
    expect(mine.length).toBe(all.rows[0].n)
    const refunds = await m.ops.searchAuditLog({ action: 'refund.', limit: 500 })
    expect(refunds.every((e) => e.action.startsWith('refund.'))).toBe(true)
    expect(refunds.length).toBeGreaterThan(3)
  })
})

describe('retention (G5-16) and privacy requests (G5-17)', () => {
  it('exports every personal field, then deletion anonymises orders and closes the account', async () => {
    directory.add({
      id: '801',
      email: 'leaving@example.com',
      roles: ['customer'],
      name: 'Leaving Customer',
    })
    const o = await placeCaptured([['DEMO-0002', { quantity: 2 }]], 'leaving@example.com')
    await sql(
      db.adminUrl,
      `UPDATE commerce.orders SET pickup_name = 'Lee', user_id = '801' WHERE id = $1`,
      [o.orderId],
    )
    const exp = await admin(ADMIN, 'POST', 'privacy/export', {}, { email: 'leaving@example.com' })
    expect(exp.status, JSON.stringify(exp.body)).toBe(200)
    for (const f of privacy.PERSONAL_FIELDS.account) expect(exp.body.account).toHaveProperty(f)
    const order = exp.body.orders.find((x: { publicId: string }) => x.publicId === o.publicId)
    for (const f of privacy.PERSONAL_FIELDS.order) expect(order).toHaveProperty(f)
    expect(order).toMatchObject({ email: 'leaving@example.com', pickupName: 'Lee' })

    const del = await admin(
      ADMIN,
      'POST',
      'privacy/delete',
      {},
      { email: 'leaving@example.com', confirm: 'DELETE' },
    )
    expect(del.body).toMatchObject({ ordersAnonymised: 1, accountClosed: true })
    const row = await orderRow(o.publicId)
    expect(row.email).toBe(`deleted-${o.orderId}@anonymised.invalid`)
    expect([row.pickup_name, row.user_id]).toEqual([null, null])
    expect(Number(row.final_total_cents)).toBeGreaterThan(0)
    expect((await directory.get('801'))!).toMatchObject({
      email: 'deleted-801@anonymised.invalid',
      name: null,
    })
    expect(directory.endedSessions).toContain('801')
    expect(
      (await sql(db.adminUrl, `SELECT kind FROM ops.privacy_requests ORDER BY id`)).rows.map(
        (r) => r.kind,
      ),
    ).toEqual(['export', 'deletion'])
    const staff = await admin(
      ADMIN,
      'POST',
      'privacy/delete',
      {},
      { email: SUPPORT.email, confirm: 'DELETE' },
    )
    expect(staff.body.error.code).toBe('STAFF_ACCOUNT')
  })

  it('customers can download their own data', async () => {
    directory.add({ id: '802', email: 'self@example.com', roles: ['customer'] })
    const me = person('802', 'self@example.com', [])
    const r = await new Browser().call('GET', 'v1/me/data', '/api/v1/me/data', undefined, {
      'x-test-user': JSON.stringify(me),
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toMatch(/attachment/)
    expect(r.body.account.email).toBe('self@example.com')
  })

  it('the retention purge anonymises old orders and deletes expired logs (fake clock)', async () => {
    const o = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await sql(
      db.adminUrl,
      `UPDATE commerce.orders SET created_at = now() - interval '8 years', pickup_name = 'Old' WHERE id = $1`,
      [o.orderId],
    )
    await sql(
      db.adminUrl,
      `UPDATE ops.notifications SET created_at = now() - interval '400 days' WHERE order_id = $1`,
      [o.orderId],
    )
    await sql(
      db.adminUrl,
      `UPDATE ops.webhook_events SET received_at = now() - interval '100 days' WHERE payload->'data'->'object'->'metadata'->>'order_id' = $1`,
      [String(o.orderId)],
    )
    const before = await ledgerBalanced(o.orderId)
    const result = await privacy.runRetentionPurge()
    expect(result.ordersAnonymised).toBeGreaterThanOrEqual(1)
    expect(result.notificationsDeleted).toBeGreaterThanOrEqual(1)
    expect(result.webhookPayloadsRedacted).toBeGreaterThanOrEqual(1)
    const row = await orderRow(o.publicId)
    expect(row.email).toBe(`anon-${o.orderId}@anonymised.invalid`)
    expect(row.pickup_name).toBeNull()
    expect(await ledgerBalanced(o.orderId)).toBe(before)
    expect((await privacy.runRetentionPurge()).ordersAnonymised).toBe(0)
  })
})

describe('admin metrics (G5-18)', () => {
  it('match SQL spot checks', async () => {
    const o = await placeCaptured([['DEMO-0002', { quantity: 2 }]])
    await collect(o)
    await sql(
      db.adminUrl,
      `UPDATE commerce.orders SET arrived_at = collected_at - interval '300 seconds' WHERE id = $1`,
      [o.orderId],
    )
    const period = {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    }
    const mt = await reporting.computeMetrics(period)
    const one = async (text: string) => (await sql(db.adminUrl, text)).rows[0]
    expect(mt.ordersPlaced).toBe(
      (
        await one(
          `SELECT count(*)::int AS n FROM commerce.orders WHERE placed_at > now() - interval '1 day'`,
        )
      ).n,
    )
    expect(mt.gmvCents).toBe(
      Number(
        (
          await one(
            `SELECT sum(amount_captured_cents) AS n FROM finance.payments WHERE captured_at IS NOT NULL`,
          )
        ).n,
      ),
    )
    const conv = await one(
      `SELECT count(*) FILTER (WHERE status NOT IN ('pending_payment', 'abandoned'))::float / count(*) AS n FROM commerce.orders WHERE created_at > now() - interval '1 day'`,
    )
    expect(mt.conversion).toBeCloseTo(conv.n, 10)
    expect(mt.pickupWaitMedianSeconds).toBe(300)
    const problems = await one(
      `SELECT count(DISTINCT i.order_id)::float / (SELECT count(*) FROM commerce.orders WHERE collected_at IS NOT NULL) AS n FROM commerce.support_issues i`,
    )
    expect(mt.problemRate).toBeCloseTo(problems.n, 10)
    const disputes = await one(
      `SELECT (SELECT count(*) FROM finance.disputes)::float / (SELECT count(*) FROM finance.payments WHERE status = 'captured') AS n`,
    )
    expect(mt.disputeRate).toBeCloseTo(disputes.n, 10)
    expect(mt.fillRate).toBe(1)
    for (const k of Object.keys(reporting.METRIC_DEFINITIONS)) expect(mt).toHaveProperty(k)
  })
})

describe('order search and the one-page order view (G5-03)', () => {
  it('finds orders by id and email, and explains one fully', async () => {
    const o = await placeCaptured([['DEMO-0002', { quantity: 2 }]], 'findme@example.com')
    const byEmail = await admin(SUPPORT, 'GET', 'orders?q=findme', {})
    expect(byEmail.body.orders.map((x: { publicId: string }) => x.publicId)).toContain(o.publicId)
    const view = await admin(SUPPORT, 'GET', 'orders/[id]', { id: o.orderId })
    expect(view.status).toBe(200)
    const sources = new Set(view.body.timeline.map((t: { source: string }) => t.source))
    for (const s of ['order', 'webhook', 'notification', 'ledger']) expect(sources).toContain(s)
    expect(view.body.refundable.remainingCents).toBe(
      Number((await payment(o.orderId)).amount_captured_cents),
    )
  })
})

describe('catalogue admin (G5-14)', () => {
  const pipeline = (args: string[], env: Record<string, string> = {}) => {
    try {
      return execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools/pipeline.mjs'), ...args], {
        env: { ...process.env, INGEST_DATABASE_URL: db.asRole('ingest_rw'), ...env },
        encoding: 'utf8',
      })
    } catch (err) {
      if ((err as { status?: number }).status === 3) return 'held'
      throw err
    }
  }

  it('held-run approval works end to end on the fixture feed', async () => {
    const before = (
      await sql(
        db.adminUrl,
        `SELECT count(*)::int AS n FROM catalog.products WHERE deleted_at IS NULL`,
      )
    ).rows[0].n
    expect(pipeline(['ingest', '--mode', 'full'], { CATALOG_FIXTURE_FRACTION: '0.5' })).toBe('held')
    const runs = await admin(ADMIN, 'GET', 'catalog/ingest-runs', {})
    const held = runs.body.runs.find((r: { status: string }) => r.status === 'held')
    expect(held.anomalies.length).toBeGreaterThan(0)
    const decided = await admin(
      ADMIN,
      'POST',
      'catalog/ingest-runs/[id]/decision',
      { id: held.id },
      { decision: 'approve' },
    )
    expect(decided.body).toMatchObject({ status: 'approval_requested' })
    expect(
      (
        await admin(
          ADMIN,
          'POST',
          'catalog/ingest-runs/[id]/decision',
          { id: held.id },
          { decision: 'approve' },
        )
      ).body.error.code,
    ).toBe('ALREADY_REQUESTED')
    pipeline(['process-requests'], { CATALOG_FIXTURE_FRACTION: '0.5' })
    const run = (
      await sql(db.adminUrl, 'SELECT status, approved_by FROM ops.ingest_runs WHERE id = $1', [
        held.id,
      ])
    ).rows[0]
    expect(run).toEqual({ status: 'approved', approved_by: '1' })
    const after = (
      await sql(
        db.adminUrl,
        `SELECT count(*)::int AS n FROM catalog.products WHERE deleted_at IS NULL`,
      )
    ).rows[0].n
    expect(after).toBe(Math.floor(before / 2))

    await admin(ADMIN, 'POST', 'catalog/ingest-runs', {}, { merchantId: 1, mode: 'full' })
    pipeline(['process-requests'])
    const reqs = (await admin(ADMIN, 'GET', 'catalog/ingest-runs', {})).body.requests
    expect(reqs[0]).toMatchObject({ kind: 'run', status: 'done' })
  })

  it('a held run can be rejected directly', async () => {
    expect(pipeline(['ingest', '--mode', 'full'], { CATALOG_FIXTURE_FRACTION: '0.3' })).toBe('held')
    const held = (await admin(ADMIN, 'GET', 'catalog/ingest-runs', {})).body.runs.find(
      (r: { status: string }) => r.status === 'held',
    )
    const r = await admin(
      ADMIN,
      'POST',
      'catalog/ingest-runs/[id]/decision',
      { id: held.id },
      { decision: 'reject' },
    )
    expect(r.body).toEqual({ status: 'rejected', requestId: null })
    expect(
      (await sql(db.adminUrl, 'SELECT staged FROM ops.ingest_runs WHERE id = $1', [held.id]))
        .rows[0].staged,
    ).toBeNull()
  })
})
