

import http from 'k6/http'
import { check, fail } from 'k6'
import { Trend } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const DURATION = __ENV.LOAD_DURATION || '2m'
const QUERIES = ['apples', 'milk', 'bread', 'cheese', 'brocoli', 'yogurt', 'coffee', 'eggs', 'pasta', 'chips']

const searchLatency = new Trend('search_latency', true)
const pageLatency = new Trend('page_latency', true)
const checkoutLatency = new Trend('checkout_latency', true)

function rate(exec, perSecond, maxVUs) {
  return {
    executor: 'constant-arrival-rate',
    exec,
    rate: Math.round(perSecond * 60),
    timeUnit: '1m',
    duration: DURATION,
    preAllocatedVUs: Math.ceil(maxVUs / 2),
    maxVUs,
  }
}

export const options = {
  scenarios: {
    search: rate('search', 6, 20),
    browse: rate('browse', 6, 20),
    checkout: rate('checkout', 0.2, 5),
  },
  thresholds: {
    search_latency: ['p(95)<300'],
    page_latency: ['p(95)<800'],
    checkout_latency: ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
}

let shopper = 0
const clientIp = () => {
  shopper++
  return `198.51.${__VU % 250}.${(shopper % 250) + 1}`
}
const pick = (list) => list[Math.floor(Math.random() * list.length)]

export function setup() {
  const res = http.get(`${BASE}/api/v1/products?limit=50`)
  if (res.status !== 200) fail(`catalogue unavailable: ${res.status}`)
  const products = res.json('items').filter((p) => p.availability === 'in_stock')
  if (!products.length) fail('no products in stock: run npm run db:setup first')
  return {
    products: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      price: p.effectivePriceCents,
      sellBy: p.sellBy,
      maxQty: p.maxQty,
    })),
  }
}

export function search() {
  const res = http.get(`${BASE}/api/v1/search?q=${pick(QUERIES)}&limit=24`, {
    headers: { 'x-forwarded-for': clientIp() },
    tags: { name: 'GET /api/v1/search' },
  })
  searchLatency.add(res.timings.duration)
  check(res, { 'search 200': (r) => r.status === 200 })
}

export function browse(data) {
  const res = http.get(`${BASE}/products/${pick(data.products).slug}`, {
    headers: { 'x-forwarded-for': clientIp() },
    tags: { name: 'GET /products/[slug]' },
  })
  pageLatency.add(res.timings.duration)
  check(res, { 'product page 200': (r) => r.status === 200 })
}

export function checkout(data) {
  const base = { 'content-type': 'application/json', 'x-forwarded-for': clientIp() }

  const p = pick(data.products.filter((x) => x.sellBy !== 'weight' && x.price >= 300))
  const quantity = Math.min(Math.max(1, Math.ceil(2000 / p.price)), p.maxQty || 99)
  const add = http.post(`${BASE}/api/v1/cart/items`, JSON.stringify({ productId: p.id, quantity }), {
    headers: base,
    tags: { name: 'POST /api/v1/cart/items' },
  })
  if (!check(add, { 'add to cart 201': (r) => r.status === 201 })) return

  const h = { ...base, cookie: `cart=${add.cookies.cart[0].value}` }
  const quote = http.post(`${BASE}/api/v1/cart/quote`, '{}', {
    headers: h,
    tags: { name: 'POST /api/v1/cart/quote' },
  })
  const slots = http.get(`${BASE}/api/v1/cart/slots`, { headers: h, tags: { name: 'GET /api/v1/cart/slots' } })
  const open = slots.status === 200 ? slots.json('slots').filter((s) => s.remaining > 0) : []
  if (
    !check(quote, { 'quote 200': (r) => r.status === 200 }) ||
    !check(open, { 'a pickup slot is open': (o) => o.length > 0 })
  )
    return
  const res = http.post(
    `${BASE}/api/v1/checkout`,
    JSON.stringify({
      quoteHash: quote.json('quote.hash'),
      email: `load-${__VU}-${__ITER}@example.com`,
      slotId: pick(open).id,
    }),
    {
      headers: { ...h, 'idempotency-key': `load-${__VU}-${__ITER}-${Date.now()}` },
      tags: { name: 'POST /api/v1/checkout' },
    },
  )
  checkoutLatency.add(res.timings.duration)
  check(res, { 'checkout 201': (r) => r.status === 201 })
}

export function handleSummary(data) {
  const out = {}
  for (const name of ['search_latency', 'page_latency', 'checkout_latency', 'http_req_duration']) {
    const m = data.metrics[name]
    if (m) out[name] = m.values
  }
  out.http_req_failed = data.metrics.http_req_failed?.values
  out.checks = data.metrics.checks?.values
  out.iterations = data.metrics.iterations?.values
  out.dropped_iterations = data.metrics.dropped_iterations?.values ?? { count: 0 }
  out.thresholds = Object.fromEntries(
    Object.entries(data.metrics)
      .filter(([, m]) => m.thresholds)
      .map(([k, m]) => [k, Object.fromEntries(Object.entries(m.thresholds).map(([t, v]) => [t, v.ok]))]),
  )
  return {
    stdout: JSON.stringify(out, null, 2) + '\n',
    '/scripts/results/summary.json': JSON.stringify(out, null, 2),
  }
}
