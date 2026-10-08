import { beforeAll, describe, expect, it, vi } from 'vitest'

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
  setupIntegrationHarness,
} from '../setup/harness'

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

setupIntegrationHarness('grocery_fulfilment_it')

type User = { id: number; email: string; roles: Array<'admin' | 'customer'>; mfaVerified: boolean }

const person = (id: number, email: string, roles: User['roles'] = ['customer']): User => ({
  id,
  email,
  roles,
  mfaVerified: true,
})
const OWNER = person(101, 'owner@demo.test')
const PICKER = person(102, 'picker@demo.test')
const PICKER2 = person(103, 'picker2@demo.test')
const MANAGER = person(104, 'manager@demo.test')
const OTHER_OWNER = person(201, 'owner@other.test')
const CUSTOMER = person(301, 'customer@demo.test')
const ADMIN = person(1, 'admin@demo.test', ['admin'])
let LOCATION = 0
let OTHER_LOCATION = 0

async function consoleCall(
  user: User | null,
  method: string,
  route: string,
  params: Record<string, string | number> = {},
  body?: unknown,
) {
  let url = `/api/console/${route}`
  for (const [k, v] of Object.entries(params)) url = url.replace(`[${k}]`, String(v))
  const b = new Browser()
  return b.call(
    method,
    `console/${route}`,
    url,
    body,
    user ? { 'x-test-user': JSON.stringify(user) } : {},
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
}

function orderAction(
  b: Browser,
  action: string,
  publicId: string,
  token: string,
  body: unknown = {},
  extra: Record<string, string> = {},
) {
  let url = `/api/v1/orders/${publicId}/${action}`
  for (const [k, v] of Object.entries(extra)) url = url.replace(`[${k}]`, v)
  return b.call(
    'POST',
    `v1/orders/[publicId]/${action}`,
    `${url}?t=${encodeURIComponent(token)}`,
    body,
    {},
    { publicId, ...extra },
  )
}

interface Placed {
  b: Browser
  publicId: string
  orderId: number
  token: string
  quote: { lines: Array<{ productId: string; lineTotalCents: number }> }
}

async function placeOrder(
  items: Array<[string, { quantity?: number; weightLb?: number }, Record<string, unknown>?]>,
  opts: { slotId?: number; email?: string } = {},
): Promise<Placed> {
  const b = new Browser()
  for (const [id, amount, extra] of items) expect((await b.add(id, amount, extra)).status).toBe(201)
  const { body } = await b.quote()
  const res = await b.checkout(
    {
      quoteHash: body.quote.hash,
      email: opts.email ?? 'shopper@example.com',
      ...(opts.slotId ? { slotId: opts.slotId } : {}),
    },
    `idem-${Math.random().toString(36).slice(2)}`,
  )
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const publicId = res.body.publicId as string
  const orderId = Number((await orderRow(publicId)).id)
  const sessionId = res.body.checkoutUrl.split('/').pop()
  stripe.pay(sessionId)
  await sendWebhook(sessionEvent('checkout.session.completed', sessionId, orderId))
  await drainWorker()
  expect((await orderRow(publicId)).status).toBe('placed')
  const token = new URL(`http://x${res.body.orderUrl}`).searchParams.get('t')!
  return { b, publicId, orderId, token, quote: body.quote }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLine = { id: number; productId: string } & Record<string, any>
const lineOf = (order: { lines: AnyLine[] }, productId: string): AnyLine =>
  order.lines.find((l) => l.productId === productId)!

beforeAll(async () => {
  await sql(
    db.adminUrl,
    `UPDATE merchant.merchants SET stripe_account_id = $1, charges_enabled = true,
       onboarding_status = 'verified' WHERE id = 1`,
    [ACCT],
  )
  LOCATION = Number(
    (await sql(db.adminUrl, 'SELECT id FROM merchant.locations WHERE merchant_id = 1')).rows[0].id,
  )

  const other = await sql(
    db.adminUrl,
    `INSERT INTO merchant.merchants (slug, name) VALUES ('other-market', 'Other Market') RETURNING id`,
  )
  OTHER_LOCATION = Number(
    (
      await sql(
        db.adminUrl,
        `INSERT INTO merchant.locations (merchant_id, slug, name) VALUES ($1, 'main', 'Other Main')
         RETURNING id`,
        [other.rows[0].id],
      )
    ).rows[0].id,
  )
  await sql(db.adminUrl, 'INSERT INTO merchant.location_settings (location_id) VALUES ($1)', [
    OTHER_LOCATION,
  ])
  const memberships: Array<[User, number, number | null, string]> = [
    [OWNER, 1, null, 'owner'],
    [PICKER, 1, LOCATION, 'picker'],
    [PICKER2, 1, LOCATION, 'picker'],
    [MANAGER, 1, null, 'manager'],
    [OTHER_OWNER, Number(other.rows[0].id), null, 'owner'],
  ]
  for (const [u, merchantId, locationId, role] of memberships)
    await sql(
      db.adminUrl,
      `INSERT INTO merchant.staff_memberships (user_id, merchant_id, location_id, role)
       VALUES ($1, $2, $3, $4)`,
      [String(u.id), merchantId, locationId, role],
    )
})

describe('slot holds under concurrency (G4-02)', () => {
  it('20 parallel checkouts on a capacity-5 slot → exactly 5 orders', async () => {
    const browsers = Array.from({ length: 20 }, () => new Browser())
    const hashes: string[] = []
    for (const b of browsers) {
      await b.add('DEMO-0002', { quantity: 2 })
      hashes.push((await b.quote()).body.quote.hash)
    }
    const { body: offered } = await browsers[0].call('GET', 'v1/cart/slots', '/api/v1/cart/slots')
    const slot = offered.slots.at(-1)
    expect(slot.remaining).toBe(5)
    const results = await Promise.all(
      browsers.map((b, i) =>
        b.checkout(
          { quoteHash: hashes[i], email: `race${i}@example.com`, slotId: slot.id },
          `race-key-${i}-000000`,
        ),
      ),
    )
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(5)
    expect(statuses.filter((s) => s === 409)).toHaveLength(15)
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_UNAVAILABLE')
    const counters = await sql(
      db.adminUrl,
      'SELECT booked, held FROM commerce.slots WHERE id = $1',
      [slot.id],
    )
    expect(counters.rows[0]).toEqual({ booked: 0, held: 5 })

    const won = results.filter((r) => r.status === 201)
    const [paid, expired] = won
    const paidOrder = await orderRow(paid.body.publicId)
    const paidSession = paid.body.checkoutUrl.split('/').pop()
    stripe.pay(paidSession)
    await sendWebhook(sessionEvent('checkout.session.completed', paidSession, Number(paidOrder.id)))
    const expiredOrder = await orderRow(expired.body.publicId)
    const expiredSession = expired.body.checkoutUrl.split('/').pop()
    await stripe.expireCheckoutSession(expiredSession)
    await sendWebhook(
      sessionEvent('checkout.session.expired', expiredSession, Number(expiredOrder.id)),
    )
    await drainWorker()
    const after = await sql(db.adminUrl, 'SELECT booked, held FROM commerce.slots WHERE id = $1', [
      slot.id,
    ])
    expect(after.rows[0]).toEqual({ booked: 1, held: 3 })
    expect(await m.scheduling.releaseExpiredHolds(new Date(Date.now() + 60 * 60_000))).toBe(3)
    const released = await sql(
      db.adminUrl,
      'SELECT booked, held FROM commerce.slots WHERE id = $1',
      [slot.id],
    )
    expect(released.rows[0]).toEqual({ booked: 1, held: 0 })
    const paidRow = await orderRow(paid.body.publicId)
    expect(paidRow.pickup_starts_at.toISOString()).toBe(slot.startsAt)
    expect(paidRow.pickup_code).toMatch(/^\d{6}$/)
  })
})

describe('slot picker rules at checkout (G4-03)', () => {
  it('refuses a slot inside the lead time, and a slot of another store', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 1 })
    await b.add('DEMO-0157', { quantity: 2 })
    const { body } = await b.quote()
    const soon = await sql(
      db.adminUrl,
      `INSERT INTO commerce.slots (location_id, starts_at, ends_at, capacity)
       VALUES ($1, now() + interval '30 minutes', now() + interval '90 minutes', 5)
       ON CONFLICT (location_id, starts_at) DO UPDATE SET capacity = 5 RETURNING id`,
      [LOCATION],
    )
    const early = await b.checkout(
      { quoteHash: body.quote.hash, email: 'early@example.com', slotId: Number(soon.rows[0].id) },
      'early-key-0000',
    )
    expect(early.status).toBe(422)
    expect(early.body.error).toMatchObject({
      code: 'SLOT_INVALID',
      details: { reason: 'past_lead_time' },
    })
    const foreign = await sql(
      db.adminUrl,
      `INSERT INTO commerce.slots (location_id, starts_at, ends_at, capacity)
       VALUES ($1, now() + interval '1 day', now() + interval '25 hours', 5) RETURNING id`,
      [OTHER_LOCATION],
    )
    const wrongStore = await b.checkout(
      {
        quoteHash: body.quote.hash,
        email: 'early@example.com',
        slotId: Number(foreign.rows[0].id),
      },
      'foreign-key-000',
    )
    expect(wrongStore.status).toBe(422)
    expect(wrongStore.body.error.code).toBe('SLOT_INVALID')
  })

  it('offers only slots after the lead time and within 5 days', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 1 })
    const { body } = await b.call('GET', 'v1/cart/slots', '/api/v1/cart/slots')
    expect(body.slots.length).toBeGreaterThan(10)
    const now = Date.now()
    for (const s of body.slots) {
      expect(new Date(s.startsAt).getTime()).toBeGreaterThanOrEqual(now + 119 * 60_000)
      expect(new Date(s.startsAt).getTime()).toBeLessThanOrEqual(now + 5 * 86_400_000)
    }
  })
})

describe('replacement preferences (G4-04)', () => {
  it('stores up to 3 ranked specific replacements per line and validates them', async () => {
    const b = new Browser()
    const added = await b.add('DEMO-0002', { quantity: 1 })
    const lineId = added.body.cart.items[0].id
    const options = await b.call(
      'GET',
      'v1/cart/items/[lineId]/replacements',
      `/api/v1/cart/items/${lineId}/replacements`,
      undefined,
      {},
      { lineId: String(lineId) },
    )
    expect(options.status).toBe(200)
    const ids = options.body.options.slice(0, 3).map((o: { productId: string }) => o.productId)
    expect(ids).toHaveLength(3)
    const patch = (body: unknown) =>
      b.call(
        'PATCH',
        'v1/cart/items/[lineId]',
        `/api/v1/cart/items/${lineId}`,
        body,
        {},
        {
          lineId: String(lineId),
        },
      )
    const ok = await patch({ replacementPreference: 'specific', replacementProductIds: ids })
    expect(ok.status).toBe(200)
    expect(ok.body.cart.items[0]).toMatchObject({
      replacementPreference: 'specific',
      replacementProductIds: ids,
    })
    expect(
      (await patch({ replacementPreference: 'specific', replacementProductIds: [] })).body.error
        .code,
    ).toBe('REPLACEMENT_INVALID')
    expect(
      (await patch({ replacementPreference: 'specific', replacementProductIds: ['NOPE-1'] })).body
        .error.code,
    ).toBe('REPLACEMENT_INVALID')

    const refund = await patch({ replacementPreference: 'refund' })
    expect(refund.body.cart.items[0].replacementProductIds).toEqual([])
  })
})

describe('merchant staff scope (G4-05)', () => {
  let order: Placed
  beforeAll(async () => {
    order = await placeOrder([
      ['DEMO-0002', { quantity: 1 }],
      ['DEMO-0157', { quantity: 2 }],
    ])
  })

  it('each staff member sees only their own stores', async () => {
    const mine = await consoleCall(PICKER, 'GET', 'locations')
    expect(mine.body.locations.map((l: { locationId: number }) => l.locationId)).toEqual([LOCATION])
    const theirs = await consoleCall(OTHER_OWNER, 'GET', 'locations')
    expect(theirs.body.locations.map((l: { locationId: number }) => l.locationId)).toEqual([
      OTHER_LOCATION,
    ])
    const admin = await consoleCall(ADMIN, 'GET', 'locations')
    expect(admin.body.locations).toHaveLength(2)
  })

  it('another store gets 404 for our orders and locations (no cross-tenant access)', async () => {
    const p = { publicId: order.publicId }
    expect((await consoleCall(OTHER_OWNER, 'GET', 'orders/[publicId]', p)).status).toBe(404)
    expect((await consoleCall(OTHER_OWNER, 'POST', 'orders/[publicId]/accept', p)).status).toBe(404)
    expect(
      (await consoleCall(OTHER_OWNER, 'GET', 'locations/[id]/queue', { id: LOCATION })).status,
    ).toBe(404)
    expect(
      (
        await consoleCall(
          OTHER_OWNER,
          'PUT',
          'locations/[id]/settings',
          { id: LOCATION },
          { paused: true },
        )
      ).status,
    ).toBe(404)
    expect((await orderRow(order.publicId)).status).toBe('placed')
  })

  it('customers are refused; anonymous callers must sign in', async () => {
    const res = await consoleCall(CUSTOMER, 'GET', 'locations')
    expect(res.status).toBe(403)
    expect((await consoleCall(null, 'GET', 'locations')).status).toBe(401)
  })

  it('a picker can work orders but not change settings; the owner can', async () => {
    expect(
      (await consoleCall(PICKER, 'GET', 'orders/[publicId]', { publicId: order.publicId })).status,
    ).toBe(200)
    const denied = await consoleCall(
      PICKER,
      'PUT',
      'locations/[id]/settings',
      { id: LOCATION },
      {
        slotCapacity: 9,
      },
    )
    expect(denied.status).toBe(403)
    expect(denied.body.error.message).toMatch(/owner/)
  })
})

describe('location settings (G4-01)', () => {
  it('owner changes are audited and apply to future slots only, never below bookings', async () => {
    const past = await sql(
      db.adminUrl,
      `INSERT INTO commerce.slots (location_id, starts_at, ends_at, capacity, booked)
       VALUES ($1, now() - interval '3 hours', now() - interval '2 hours', 5, 4) RETURNING id`,
      [LOCATION],
    )
    const booked = await sql(
      db.adminUrl,
      `SELECT id FROM commerce.slots WHERE location_id = $1 AND booked > 0 AND starts_at > now()
       ORDER BY starts_at LIMIT 1`,
      [LOCATION],
    )
    const res = await consoleCall(
      OWNER,
      'PUT',
      'locations/[id]/settings',
      { id: LOCATION },
      {
        slotCapacity: 3,
        leadTimeMinutes: 60,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.settings).toMatchObject({ slotCapacity: 3, leadTimeMinutes: 60 })
    const caps = await sql(
      db.adminUrl,
      `SELECT id, capacity, booked, held FROM commerce.slots WHERE location_id = $1 AND starts_at > now()`,
      [LOCATION],
    )
    for (const s of caps.rows) expect(s.capacity).toBe(Math.max(3, s.booked + s.held))
    const pastRow = await sql(db.adminUrl, 'SELECT capacity FROM commerce.slots WHERE id = $1', [
      past.rows[0].id,
    ])
    expect(pastRow.rows[0].capacity).toBe(5)
    if (booked.rows[0]) {
      const b = caps.rows.find((r) => r.id === booked.rows[0].id)
      expect(b.capacity).toBeGreaterThanOrEqual(b.booked + b.held)
    }
    const audit = await sql(
      db.adminUrl,
      `SELECT actor_type, actor_id, data FROM ops.audit_log WHERE action = 'location.settings.update'`,
    )
    expect(audit.rows.at(-1)).toMatchObject({ actor_type: 'merchant_staff', actor_id: '101' })
    expect(audit.rows.at(-1).data.before).toMatchObject({ slotCapacity: 5, leadTimeMinutes: 120 })

    await consoleCall(
      OWNER,
      'PUT',
      'locations/[id]/settings',
      { id: LOCATION },
      {
        slotCapacity: 5,
        leadTimeMinutes: 120,
      },
    )
  })

  it('a holiday closure removes that day from the slot picker (booked slots stay, closed)', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 1 })
    const before = (await b.call('GET', 'v1/cart/slots', '/api/v1/cart/slots')).body
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: before.timeZone }).format(
      new Date(before.slots.at(-1).startsAt),
    )
    const closed = await consoleCall(
      OWNER,
      'POST',
      'locations/[id]/closures',
      { id: LOCATION },
      {
        date: day,
        reason: 'Holiday',
      },
    )
    expect(closed.status).toBe(200)
    const after = (await b.call('GET', 'v1/cart/slots', '/api/v1/cart/slots')).body
    const dayOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: before.timeZone }).format(new Date(iso))
    expect(after.slots.some((s: { startsAt: string }) => dayOf(s.startsAt) === day)).toBe(false)

    const kept = await sql(
      db.adminUrl,
      `SELECT closed, booked FROM commerce.slots WHERE location_id = $1 AND booked > 0
         AND to_char(starts_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') = $2`,
      [LOCATION, day],
    )
    for (const r of kept.rows) expect(r.closed).toBe(true)
    const reopened = await consoleCall(OWNER, 'DELETE', 'locations/[id]/closures/[date]', {
      id: LOCATION,
      date: day,
    })
    expect(reopened.body.closures).toEqual([])
  })

  it('pause stops new checkouts at once; placed orders are unaffected', async () => {
    const b = new Browser()
    await b.add('DEMO-0002', { quantity: 2 })
    const slotId = await b.firstSlot()
    const { body } = await b.quote()
    await consoleCall(
      OWNER,
      'PUT',
      'locations/[id]/settings',
      { id: LOCATION },
      {
        paused: true,
        pauseReason: 'Inventory count',
      },
    )
    const slots = (await b.call('GET', 'v1/cart/slots', '/api/v1/cart/slots')).body
    expect(slots).toMatchObject({ paused: true, slots: [] })
    const res = await b.checkout(
      { quoteHash: body.quote.hash, email: 'p@example.com', slotId },
      'pause-key-000',
    )
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('MERCHANT_PAUSED')
    await consoleCall(
      OWNER,
      'PUT',
      'locations/[id]/settings',
      { id: LOCATION },
      {
        paused: false,
        pauseReason: null,
      },
    )
  })
})

describe('order → accept → pick → weigh/scan → replace → capture → handover', () => {
  let o: Placed
  const p = () => ({ publicId: o.publicId })
  let lines: Record<string, number> = {}

  it('the new order shows in the store queue with its auto-reject time (G4-06)', async () => {
    o = await placeOrder([
      ['DEMO-0002', { quantity: 2 }], // each, 9.39, zero-rated
      ['DEMO-0157', { quantity: 3 }], // each, 5.59, HST + 10¢ deposit
      ['DEMO-0006', { weightLb: 1.5 }], // bananas by weight, 4.09/lb (scale label)
      ['DEMO-0001', { quantity: 2 }, { replacementPreference: 'refund' }], // apples, est. 1.57 lb each
    ])
    const queue = await consoleCall(PICKER, 'GET', 'locations/[id]/queue', { id: LOCATION })
    expect(queue.status).toBe(200)
    const entry = queue.body.orders.find((x: { publicId: string }) => x.publicId === o.publicId)
    expect(entry).toMatchObject({ status: 'placed', itemCount: 4, weighedCount: 2 })
    expect(new Date(entry.autoRejectAt).getTime() - new Date(entry.placedAt).getTime()).toBe(
      15 * 60_000,
    )
    expect(entry.pickupName).toBe('shopper')
  })

  it('accept, then one picker per order; taking over must be confirmed (G4-07, G4-08)', async () => {
    expect((await consoleCall(PICKER, 'POST', 'orders/[publicId]/accept', p())).status).toBe(200)
    const again = await consoleCall(PICKER, 'POST', 'orders/[publicId]/accept', p())
    expect(again.body.error.code).toBe('ORDER_STATE_CONFLICT')
    const start = await consoleCall(PICKER, 'POST', 'orders/[publicId]/start', p(), {})
    expect(start.body).toMatchObject({ status: 'picking', pickedByMe: true, unresolvedLines: 4 })
    lines = Object.fromEntries(
      start.body.lines.map((l: { productId: string; id: number }) => [l.productId, l.id]),
    )
    const clash = await consoleCall(PICKER2, 'POST', 'orders/[publicId]/start', p(), {})
    expect(clash.body.error.code).toBe('PICKER_CONFLICT')
    const pickAsOther = await consoleCall(
      PICKER2,
      'POST',
      'orders/[publicId]/lines/[lineId]',
      { ...p(), lineId: lines['DEMO-0157'] },
      { action: 'picked' },
    )
    expect(pickAsOther.body.error.code).toBe('PICKER_CONFLICT')
    const takeover = await consoleCall(PICKER2, 'POST', 'orders/[publicId]/start', p(), {
      takeover: true,
    })
    expect(takeover.body.pickedByMe).toBe(true)
    await consoleCall(PICKER, 'POST', 'orders/[publicId]/start', p(), { takeover: true })
    const events = await sql(
      db.adminUrl,
      `SELECT actor_id FROM commerce.order_events WHERE order_id = $1 AND type = 'pick_takeover'`,
      [o.orderId],
    )
    expect(events.rows.map((r) => r.actor_id)).toEqual(['103', '102'])
  })

  it('scan-to-verify blocks the wrong item and logs unknown barcodes (G4-10)', async () => {
    const pick = (body: unknown) =>
      consoleCall(
        PICKER,
        'POST',
        'orders/[publicId]/lines/[lineId]',
        {
          ...p(),
          lineId: lines['DEMO-0157'],
        },
        body,
      )
    const wrong = await pick({ action: 'picked', scannedCode: '420260000204' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error).toMatchObject({
      code: 'WRONG_ITEM',
      details: { scannedProductId: 'DEMO-0002' },
    })
    const unknown = await pick({ action: 'picked', scannedCode: '036000291452' })
    expect(unknown.body.error.code).toBe('UNKNOWN_BARCODE')
    const logged = await sql(db.adminUrl, 'SELECT code FROM ops.unrecognised_barcodes')
    expect(logged.rows.map((r) => r.code)).toContain('036000291452')
    expect((await pick({ action: 'picked', quantity: 4 })).body.error.code).toBe('QUANTITY_INVALID')
    const ok = await pick({ action: 'picked', scannedCode: '420260015703' })
    expect(ok.status).toBe(200)
    expect(lineOf(ok.body.order, 'DEMO-0157')).toMatchObject({
      status: 'picked',
      pickedQuantity: 3,
    })

    const scan = await consoleCall(PICKER, 'POST', 'orders/[publicId]/scan', p(), {
      code: '420260000204',
    })
    expect(scan.body).toMatchObject({ match: 'line', lineId: lines['DEMO-0002'], kind: 'standard' })
  })

  it('weights far from the estimate need confirming; a deli label sets the price (G4-09, G4-11)', async () => {
    const weigh = (body: unknown) =>
      consoleCall(
        PICKER,
        'POST',
        'orders/[publicId]/lines/[lineId]',
        {
          ...p(),
          lineId: lines['DEMO-0006'],
        },
        body,
      )
    const heavy = await weigh({ action: 'picked', weightLb: 3 })
    expect(heavy.status).toBe(422)
    expect(heavy.body.error).toMatchObject({
      code: 'WEIGHT_CONFIRMATION_REQUIRED',
      details: { weightLb: 3, estimatedWeightLb: 1.5 },
    })
    expect((await weigh({ action: 'picked' })).body.error.code).toBe('WEIGHT_REQUIRED')

    const label = m.fulfilment.encodeScaleLabel('200006000008', 700)
    const labelled = await weigh({ action: 'picked', scannedCode: label })
    expect(labelled.status).toBe(200)
    expect(lineOf(labelled.body.order, 'DEMO-0006')).toMatchObject({
      status: 'picked',
      labelPriceCents: 700,
      actualWeightLb: 1.711, // 700 / 409 per lb
    })

    const apples = await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/lines/[lineId]',
      {
        ...p(),
        lineId: lines['DEMO-0001'],
      },
      { action: 'picked', quantity: 2, weightLb: 3.3 },
    )
    expect(lineOf(apples.body.order, 'DEMO-0001').actualWeightLb).toBe(3.3)
  })

  it('complete is refused while items are unpicked (G4-13)', async () => {
    const res = await consoleCall(PICKER, 'POST', 'orders/[publicId]/complete', p(), {})
    expect(res.body.error).toMatchObject({ code: 'LINES_NOT_PICKED', details: { lineNos: [1] } })
  })

  it('replacements follow the preference and never cost more (G4-12)', async () => {
    const refund = await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/lines/[lineId]/substitute',
      {
        ...p(),
        lineId: lines['DEMO-0001'],
      },
      { productId: 'DEMO-0003' },
    )
    expect(refund.body.error.code).toBe('SUBSTITUTION_NOT_ALLOWED')

    const unavailable = await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/lines/[lineId]',
      {
        ...p(),
        lineId: lines['DEMO-0002'],
      },
      { action: 'unavailable', reason: 'out_of_stock' },
    )
    expect(unavailable.body.suggestOutOfStock).toMatchObject({ productId: 'DEMO-0002' })

    const options = await consoleCall(
      PICKER,
      'GET',
      'orders/[publicId]/lines/[lineId]/replacements',
      {
        ...p(),
        lineId: lines['DEMO-0002'],
      },
    )
    expect(options.body.preference).toBe('best_match')
    expect(options.body.options.length).toBeGreaterThan(0)

    const sub = (productId: string) =>
      consoleCall(
        PICKER,
        'POST',
        'orders/[publicId]/lines/[lineId]/substitute',
        {
          ...p(),
          lineId: lines['DEMO-0002'],
        },
        { productId, quantity: 2, reason: 'Out of stock' },
      )

    const dearer = await sub('DEMO-0158')
    expect(dearer.body.error.code).toBe('SUBSTITUTE_COSTS_MORE')

    const ok = await sub('DEMO-0004')
    expect(ok.status).toBe(200)
    const line = lineOf(ok.body, 'DEMO-0002')
    expect(line.status).toBe('substituted')
    expect(line.substitute).toMatchObject({
      productId: 'DEMO-0004',
      customerDecision: 'pending',
      lineTotalCents: 4198,
    })
    expect(ok.body.money.projectedTotalCents).toBe(6051)
    await drainWorker()
    expect(mail.some((x) => x.subject === `Order ${o.publicId}: we replaced an item`)).toBe(true)
  })

  it('the customer can reject, then approve, a replacement until picking completes', async () => {
    const order = await o.b.call(
      'GET',
      'v1/orders/[publicId]',
      `/api/v1/orders/${o.publicId}?t=${encodeURIComponent(o.token)}`,
      undefined,
      {},
      p(),
    )
    const sub = order.body.lines.find((l: { replaces: unknown }) => l.replaces)
    expect(sub).toMatchObject({ customerDecision: 'pending', replaces: { lineNo: 1 } })
    const decide = (decision: string) =>
      orderAction(
        o.b,
        'substitutions/[lineId]',
        o.publicId,
        o.token,
        { decision },
        {
          lineId: String(sub.lineId),
        },
      )
    const rejected = await decide('rejected')
    expect(
      rejected.body.lines.find((l: { lineId: number }) => l.lineId === sub.lineId),
    ).toMatchObject({
      status: 'unavailable',
      customerDecision: 'rejected',
    })
    const view = await consoleCall(PICKER, 'GET', 'orders/[publicId]', p())
    expect(view.body.money.projectedTotalCents).toBe(6051 - 1878)
    const approved = await decide('approved')
    expect(approved.status).toBe(200)
    const back = await consoleCall(PICKER, 'GET', 'orders/[publicId]', p())
    expect(back.body.money.projectedTotalCents).toBe(6051)
  })

  it('completing picking captures exactly the final amount, fee on the final subtotal (G4-13)', async () => {
    const done = await consoleCall(PICKER, 'POST', 'orders/[publicId]/complete', p(), {})
    expect(done.body.status).toBe('picked')
    await drainWorker()
    const row = await orderRow(o.publicId)

    expect(row).toMatchObject({
      status: 'ready',
      final_item_subtotal_cents: '5803',
      final_tax_cents: '218',
      final_deposit_cents: '30',
      final_total_cents: '6051',
      fee_final_cents: '870', // 15% of 58.03
    })
    const capture = stripe.captures.find((c) => c.key === `capture:${o.orderId}`)!
    expect(capture.amounts).toEqual({ amountToCaptureCents: 6051, applicationFeeCents: 870 })
    const ledger = await m.payments.getOrderLedger(o.orderId)
    expect(ledger.reduce((s, a) => s + a.debitCents - a.creditCents, 0)).toBe(0)
  })

  it('the ready email is a receipt that matches the ledger to the cent (G4-17)', async () => {
    const ready = mail.find((x) => x.subject === `Order ${o.publicId} is ready for pickup`)!
    expect(ready).toBeDefined()
    const journal = await sql(
      db.adminUrl,
      `SELECT sum(e.debit_cents)::int AS captured FROM finance.ledger_entries e
       JOIN finance.ledger_journals j ON j.id = e.journal_id
       WHERE j.idempotency_key = $1 AND e.account = 'stripe_clearing'`,
      [`capture:${o.orderId}`],
    )
    expect(journal.rows[0].captured).toBe(6051)
    expect(ready.text).toContain('Total charged: $60.51')
    expect(ready.text).toContain('HST $2.18')
    expect(ready.text).toContain('Card hold $62.03; released $1.52')
    expect(ready.text).toMatch(/Pickup code: \d{6}/)
    expect(ready.text).toContain('Sold by Demo Market (HST 000000000RT0001)')
    expect(ready.text).toContain('(replaces Harbour Kitchen Honeycrisp Apples)')
  })

  it('replacements can no longer be changed once packed', async () => {
    const view = await o.b.call(
      'GET',
      'v1/orders/[publicId]',
      `/api/v1/orders/${o.publicId}?t=${encodeURIComponent(o.token)}`,
      undefined,
      {},
      p(),
    )
    const sub = view.body.lines.find((l: { replaces: unknown }) => l.replaces)
    const late = await orderAction(
      o.b,
      'substitutions/[lineId]',
      o.publicId,
      o.token,
      {
        decision: 'rejected',
      },
      { lineId: String(sub.lineId) },
    )
    expect(late.body.error.code).toBe('PICKING_COMPLETE')
  })

  it('"I\'m here", wrong codes lock the order, a manager unlocks, handover is recorded (G4-14)', async () => {
    const here = await orderAction(o.b, 'arrived', o.publicId, o.token, {
      note: 'Blue car, spot 4',
    })
    expect(here.body.pickup.arrivedAt).not.toBeNull()
    const queue = await consoleCall(PICKER, 'GET', 'locations/[id]/queue', { id: LOCATION })
    expect(
      queue.body.orders.find((x: { publicId: string }) => x.publicId === o.publicId),
    ).toMatchObject({
      status: 'ready',
      arrivalNote: 'Blue car, spot 4',
    })
    const code = (await orderRow(o.publicId)).pickup_code as string
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 4; i >= 1; i--) {
      const res = await consoleCall(PICKER, 'POST', 'orders/[publicId]/handover', p(), {
        code: wrong,
      })
      expect(res.body.error).toMatchObject({
        code: 'WRONG_PICKUP_CODE',
        details: { attemptsLeft: i },
      })
    }
    const locked = await consoleCall(PICKER, 'POST', 'orders/[publicId]/handover', p(), {
      code: wrong,
    })
    expect(locked.status).toBe(423)
    const stillLocked = await consoleCall(PICKER, 'POST', 'orders/[publicId]/handover', p(), {
      code,
    })
    expect(stillLocked.body.error.code).toBe('PICKUP_LOCKED')
    expect((await consoleCall(PICKER, 'POST', 'orders/[publicId]/unlock', p())).status).toBe(403)
    expect((await consoleCall(MANAGER, 'POST', 'orders/[publicId]/unlock', p())).status).toBe(200)
    const handed = await consoleCall(PICKER, 'POST', 'orders/[publicId]/handover', p(), { code })
    expect(handed.body.status).toBe('collected')
    const row = await orderRow(o.publicId)
    expect(row).toMatchObject({ status: 'collected', handed_over_by: '102' })
    const event = await sql(
      db.adminUrl,
      `SELECT actor_type, actor_id, data FROM commerce.order_events
       WHERE order_id = $1 AND to_status = 'collected'`,
      [o.orderId],
    )
    expect(event.rows[0]).toMatchObject({ actor_type: 'merchant_staff', actor_id: '102' })
  })

  it('rating and buy again (G4-19)', async () => {
    const rated = await orderAction(o.b, 'rating', o.publicId, o.token, {
      rating: 4,
      tags: ['fresh', 'good_substitutes'],
      comment: 'Nice bananas',
    })
    expect(rated.body.rating).toEqual({
      rating: 4,
      tags: ['fresh', 'good_substitutes'],
      comment: 'Nice bananas',
    })
    await sql(
      db.adminUrl,
      `INSERT INTO catalog.product_overrides (product_id, hidden, updated_by) VALUES ('DEMO-0157', true, 'test')`,
    )
    const fresh = new Browser()
    const again = await orderAction(fresh, 'reorder', o.publicId, o.token, {})
    expect(again.status).toBe(200)
    expect(again.body.added.map((a: { productId: string }) => a.productId).sort()).toEqual([
      'DEMO-0001',
      'DEMO-0002',
      'DEMO-0006',
    ])
    expect(again.body.unavailable).toEqual([
      { productId: 'DEMO-0157', name: 'Cedar & Salt Sparkling Water 500 ml' },
    ])
    expect(again.body.cart.items).toHaveLength(3)
    await sql(db.adminUrl, `DELETE FROM catalog.product_overrides WHERE product_id = 'DEMO-0157'`)
  })
})

describe('acceptance deadlines and rejects (G4-07)', () => {
  it('escalates at 10 minutes and auto-rejects at 15, voiding the hold (fake clock)', async () => {
    const o = await placeOrder([['DEMO-0002', { quantity: 2 }]])
    const placedAt = (await orderRow(o.publicId)).placed_at as Date
    const at = (min: number) => new Date(placedAt.getTime() + min * 60_000)

    await m.fulfilment.runAcceptanceSweep(at(9))
    expect((await orderRow(o.publicId)).escalated_at).toBeNull()
    await m.fulfilment.runAcceptanceSweep(at(10.5))
    expect((await orderRow(o.publicId)).escalated_at).toEqual(at(10.5))
    expect((await orderRow(o.publicId)).status).toBe('placed')
    const alert = await sql(db.adminUrl, `SELECT kind FROM ops.alerts WHERE dedupe_key = $1`, [
      `order-unaccepted:${o.orderId}`,
    ])
    expect(alert.rows).toHaveLength(1)
    await m.fulfilment.runAcceptanceSweep(at(16))
    const row = await orderRow(o.publicId)
    expect(row.status).toBe('cancelled')
    const pi = (
      await sql(db.adminUrl, 'SELECT payment_intent_id FROM finance.payments WHERE order_id = $1', [
        o.orderId,
      ])
    ).rows[0].payment_intent_id
    expect(stripe.cancels).toContain(pi)
    const hold = await sql(
      db.adminUrl,
      'SELECT status FROM commerce.slot_holds WHERE order_id = $1',
      [o.orderId],
    )
    expect(hold.rows[0].status).toBe('released')
    await drainWorker()
    const email = mail.find((x) => x.subject === `Order ${o.publicId} cancelled`)!
    expect(email.text).toMatch(/couldn't confirm your order in time/)
  })

  it('a store reject voids at once and apologises', async () => {
    const o = await placeOrder([['DEMO-0002', { quantity: 2 }]])
    const res = await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/reject',
      { publicId: o.publicId },
      {
        reason: 'too_busy',
      },
    )
    expect(res.body.status).toBe('cancelled')
    await drainWorker()
    const email = mail.find((x) => x.subject === `Order ${o.publicId} cancelled`)!
    expect(email.text).toMatch(/couldn't take your order/)
    expect(email.text).toMatch(/not been charged/)
  })
})

describe('customer cancel before acceptance (G4-15)', () => {
  it('voids the hold and frees the slot; refused once the store accepted', async () => {
    const o = await placeOrder([['DEMO-0002', { quantity: 2 }]])
    const slotId = (await orderRow(o.publicId)).slot_id
    const booked = async () =>
      (await sql(db.adminUrl, 'SELECT booked FROM commerce.slots WHERE id = $1', [slotId])).rows[0]
        .booked
    const before = await booked()
    const res = await orderAction(o.b, 'cancel', o.publicId, o.token)
    expect(res.body).toMatchObject({ status: 'cancelled', actions: { cancel: false } })
    expect(await booked()).toBe(before - 1)
    const hold = await sql(
      db.adminUrl,
      'SELECT status FROM commerce.slot_holds WHERE order_id = $1',
      [o.orderId],
    )
    expect(hold.rows[0].status).toBe('released')

    const accepted = await placeOrder([['DEMO-0002', { quantity: 2 }]])
    await consoleCall(PICKER, 'POST', 'orders/[publicId]/accept', { publicId: accepted.publicId })
    const late = await orderAction(accepted.b, 'cancel', accepted.publicId, accepted.token)
    expect(late.status).toBe(409)

    const stranger = await orderAction(new Browser(), 'cancel', accepted.publicId, 'forged')
    expect(stranger.status).toBe(404)
  })
})

describe('final total above the card hold (G4-13, ORDERS §6)', () => {
  it('asks the picker to confirm, then captures the authorised amount and alerts', async () => {
    const o = await placeOrder([['DEMO-0006', { weightLb: 4 }]])
    const p = { publicId: o.publicId }
    await consoleCall(PICKER, 'POST', 'orders/[publicId]/accept', p)
    const start = await consoleCall(PICKER, 'POST', 'orders/[publicId]/start', p, {})
    const lineId = start.body.lines[0].id
    await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/lines/[lineId]',
      { ...p, lineId },
      {
        action: 'picked',
        weightLb: 5.9, // 24.13
        confirmUnusualWeight: true,
      },
    )
    const refused = await consoleCall(PICKER, 'POST', 'orders/[publicId]/complete', p, {})
    expect(refused.body.error).toMatchObject({ code: 'OVER_AUTHORIZATION' })
    const auth = Number((await orderRow(o.publicId)).authorization_cents)
    expect(refused.body.error.details).toMatchObject({ finalTotalCents: 2413, ceilingCents: auth })
    await consoleCall(PICKER, 'POST', 'orders/[publicId]/complete', p, {
      confirmOverAuthorization: true,
    })
    await drainWorker()
    const row = await orderRow(o.publicId)
    expect(row.status).toBe('ready')
    const capture = stripe.captures.find((c) => c.key === `capture:${o.orderId}`)!
    expect(capture.amounts).toMatchObject({ amountToCaptureCents: auth })
    const alert = await sql(db.adminUrl, `SELECT kind FROM ops.alerts WHERE dedupe_key = $1`, [
      `capture-shortfall:${o.orderId}`,
    ])
    expect(alert.rows).toHaveLength(1)
  })
})

describe('no-show (G4-14)', () => {
  it('a ready order not collected 24 h after its window becomes a no-show, and can still be handed over', async () => {
    const o = await placeOrder([['DEMO-0002', { quantity: 2 }]])
    await m.payments.fastForwardToPicked(o.orderId, { type: 'admin', id: '1' })
    await drainWorker()
    expect((await orderRow(o.publicId)).status).toBe('ready')
    const endsAt = (await orderRow(o.publicId)).pickup_ends_at as Date
    await m.fulfilment.runNoShowSweep(new Date(endsAt.getTime() + 23 * 3600_000))
    expect((await orderRow(o.publicId)).status).toBe('ready')
    await m.fulfilment.runNoShowSweep(new Date(endsAt.getTime() + 24 * 3600_000))
    expect((await orderRow(o.publicId)).status).toBe('no_show')
    const code = (await orderRow(o.publicId)).pickup_code
    const res = await consoleCall(
      PICKER,
      'POST',
      'orders/[publicId]/handover',
      { publicId: o.publicId },
      {
        code,
      },
    )
    expect(res.body.status).toBe('collected')
  })
})

describe('"out of stock today" (G4-20)', () => {
  const visible = async (id: string) =>
    (await sql(db.adminUrl, 'SELECT is_visible FROM catalog.product_view WHERE id = $1', [id]))
      .rows[0].is_visible
  const hiddenUntil = async () => {
    const settings = (await m.scheduling.getLocationSettings(LOCATION))!
    return m.scheduling.nextOpening(settings, new Set(), new Date())!.toISOString()
  }

  it('hides a product until the next opening, then shows it again', async () => {
    const res = await consoleCall(
      PICKER,
      'PUT',
      'locations/[id]/availability/products/[productId]',
      { id: LOCATION, productId: 'DEMO-0005' },
      { outOfStock: true },
    )
    expect(res.status).toBe(200)
    expect(res.body.hiddenUntil).toBe(await hiddenUntil())
    expect(await visible('DEMO-0005')).toBe(false)
    const list = await consoleCall(PICKER, 'GET', 'locations/[id]/availability', { id: LOCATION })
    expect(list.body.products.map((x: { productId: string }) => x.productId)).toContain('DEMO-0005')
    await consoleCall(
      PICKER,
      'PUT',
      'locations/[id]/availability/products/[productId]',
      {
        id: LOCATION,
        productId: 'DEMO-0005',
      },
      { outOfStock: false },
    )
    expect(await visible('DEMO-0005')).toBe(true)
  })

  it('hides a whole category, and another store cannot touch ours', async () => {
    const cat = await sql(
      db.adminUrl,
      `SELECT category_id FROM catalog.product_view WHERE id = 'DEMO-0067'`,
    )
    const categoryId = Number(cat.rows[0].category_id)
    const route = 'locations/[id]/availability/categories/[categoryId]'
    const foreign = await consoleCall(
      OTHER_OWNER,
      'PUT',
      route,
      { id: LOCATION, categoryId },
      {
        outOfStock: true,
      },
    )
    expect(foreign.status).toBe(404)
    const res = await consoleCall(
      PICKER,
      'PUT',
      route,
      { id: LOCATION, categoryId },
      { outOfStock: true },
    )
    expect(res.body.products).toBeGreaterThan(5)
    expect(await visible('DEMO-0067')).toBe(false)
    const events = await sql(
      db.adminUrl,
      `SELECT count(*)::int AS n FROM ops.outbox WHERE topic = 'product.changed'
         AND payload->>'reason' = 'availability'`,
    )
    expect(events.rows[0].n).toBe(res.body.products)
    await consoleCall(PICKER, 'PUT', route, { id: LOCATION, categoryId }, { outOfStock: false })
    expect(await visible('DEMO-0067')).toBe(true)
  })
})
