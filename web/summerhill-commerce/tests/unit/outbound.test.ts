import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createStripeClient } from '@/modules/payments'
import {
  CircuitOpenError,
  guard,
  guardedFetch,
  OutboundTimeoutError,
  resetGuardsForTests,
  setGuardSettingsForTests,
  setOutboundClockForTests,
} from '@/server/outbound'

// G6-05: the outbound guard (timeout, retry with jitter for idempotent calls, circuit breaker).
const networkError = () =>
  Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })

let now = 0
const sleeps: number[] = []
beforeEach(() => {
  resetGuardsForTests()
  now = 1_000_000
  sleeps.length = 0
  setOutboundClockForTests({
    now: () => now,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  })
})
afterEach(() => setOutboundClockForTests(null))

describe('timeouts', () => {
  it('aborts an attempt that takes too long and says which dependency', async () => {
    setGuardSettingsForTests('revalidate', { timeoutMs: 20, retries: 0 })
    let aborted = false
    const err = await guard('revalidate')
      .run(
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true
              reject(signal.reason)
            })
          }),
        { idempotent: true },
      )
      .catch((e) => e)
    expect(err).toBeInstanceOf(OutboundTimeoutError)
    expect((err as Error).message).toBe('revalidate did not answer within 20 ms')
    expect(aborted).toBe(true)
  })
})

describe('retries', () => {
  it('retries idempotent calls with exponential backoff and full jitter', async () => {
    setGuardSettingsForTests('stripe', { retries: 2, baseDelayMs: 250, maxDelayMs: 2_000 })
    let calls = 0
    const result = await guard('stripe').run(
      async () => {
        if (++calls < 3) throw networkError()
        return 'ok'
      },
      { idempotent: true },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    // random() = 0.5 of min(cap, base × 2^attempt)
    expect(sleeps).toEqual([125, 250])
  })

  it('tries a non-idempotent call once: a retry could do it twice', async () => {
    let calls = 0
    await expect(
      guard('stripe').run(
        async () => {
          calls++
          throw networkError()
        },
        { idempotent: false },
      ),
    ).rejects.toThrow('ECONNREFUSED')
    expect(calls).toBe(1)
  })

  it("doesn't retry or count a rejected request (4xx): the dependency is fine", async () => {
    setGuardSettingsForTests('stripe', { failureThreshold: 1 })
    let calls = 0
    const bad = Object.assign(new Error('No such payment_intent'), { statusCode: 404 })
    await expect(
      guard('stripe').run(
        async () => {
          calls++
          throw bad
        },
        { idempotent: true },
      ),
    ).rejects.toBe(bad)
    expect(calls).toBe(1)
    expect(guard('stripe').circuit).toBe('closed')
  })

  it('returns the last failed response when retries run out, and honours noRetry', async () => {
    let calls = 0
    const res = await guard('stripe').run(async () => ({ status: 503, n: ++calls }), {
      idempotent: true,
      failed: (r) => r.status >= 500,
    })
    expect(res).toEqual({ status: 503, n: 3 })
    calls = 0
    await guard('stripe').run(async () => ({ status: 500, n: ++calls }), {
      idempotent: true,
      failed: (r) => r.status >= 500,
      noRetry: () => true,
    })
    expect(calls).toBe(1)
  })
})

describe('circuit breaker', () => {
  const failing = () =>
    guard('elasticsearch')
      .run(
        async () => {
          throw networkError()
        },
        { idempotent: false },
      )
      .catch((e) => e)

  it('opens after consecutive failures and then fails fast without calling', async () => {
    setGuardSettingsForTests('elasticsearch', { failureThreshold: 3, resetMs: 15_000 })
    for (let i = 0; i < 3; i++) expect(await failing()).not.toBeInstanceOf(CircuitOpenError)
    expect(guard('elasticsearch').circuit).toBe('open')
    let called = false
    const err = await guard('elasticsearch')
      .run(async () => (called = true), { idempotent: true })
      .catch((e) => e)
    expect(err).toBeInstanceOf(CircuitOpenError)
    expect(called).toBe(false)
  })

  it('lets one trial through after the reset time; success closes, failure re-opens', async () => {
    setGuardSettingsForTests('elasticsearch', { failureThreshold: 1, resetMs: 15_000 })
    await failing()
    now += 15_000
    expect(await failing()).not.toBeInstanceOf(CircuitOpenError) // the trial ran, and failed
    expect(guard('elasticsearch').circuit).toBe('open')
    expect(await failing()).toBeInstanceOf(CircuitOpenError) // the timer restarted
    now += 15_000
    expect(await guard('elasticsearch').run(async () => 'up', { idempotent: true })).toBe('up')
    expect(guard('elasticsearch').circuit).toBe('closed')
  })

  it('allows only one trial at a time while half-open', async () => {
    setGuardSettingsForTests('elasticsearch', { failureThreshold: 1, resetMs: 1 })
    await failing()
    now += 1
    let release!: () => void
    const trial = guard('elasticsearch').run(
      () => new Promise<string>((r) => (release = () => r('ok'))),
      {
        idempotent: true,
      },
    )
    const second = await guard('elasticsearch')
      .run(async () => 'x', { idempotent: true })
      .catch((e) => e)
    expect(second).toBeInstanceOf(CircuitOpenError)
    release()
    expect(await trial).toBe('ok')
  })

  it('stops retrying once the circuit opens mid-call', async () => {
    setGuardSettingsForTests('stripe', { failureThreshold: 2, retries: 5 })
    let calls = 0
    await guard('stripe')
      .run(
        async () => {
          calls++
          throw networkError()
        },
        { idempotent: true },
      )
      .catch(() => {})
    expect(calls).toBe(2)
  })
})

describe('guarded fetch and the Stripe client, against a local server', () => {
  let server: http.Server
  let base = ''
  const requests: Array<{ method: string; key: string | undefined; url: string }> = []
  let plan: Array<{ status: number; headers?: Record<string, string>; hang?: boolean }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push({
        method: req.method!,
        key: req.headers['idempotency-key'] as string | undefined,
        url: req.url!,
      })
      const step = plan.shift() ?? { status: 200 }
      if (step.hang) return // never answers
      res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers })
      res.end(
        JSON.stringify(
          step.status < 400
            ? { id: 'pi_123', object: 'payment_intent', status: 'succeeded' }
            : { error: { type: 'api_error', message: 'boom' } },
        ),
      )
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))
  beforeEach(() => {
    requests.length = 0
    plan = []
  })

  it('retries GETs on 5xx, but not POSTs without an idempotency key', async () => {
    plan = [{ status: 503 }, { status: 200 }]
    expect((await guardedFetch('revalidate')(`${base}/a`)).status).toBe(200)
    expect(requests).toHaveLength(2)
    requests.length = 0
    plan = [{ status: 503 }]
    expect((await guardedFetch('revalidate')(`${base}/b`, { method: 'POST' })).status).toBe(503)
    expect(requests).toHaveLength(1)
  })

  const stripe = () =>
    createStripeClient('sk_test_unit', {
      host: '127.0.0.1',
      port: Number(base.split(':')[2]),
      protocol: 'http',
    })

  it('Stripe: a keyed write is retried with the SAME idempotency key, so it happens once', async () => {
    plan = [{ status: 500 }, { status: 502 }, { status: 200 }]
    const pi = await stripe().paymentIntents.capture('pi_123', {}, { idempotencyKey: 'capture:42' })
    expect(pi.status).toBe('succeeded')
    expect(requests.map((r) => r.key)).toEqual(['capture:42', 'capture:42', 'capture:42'])
  })

  it('Stripe: a write without a key is tried once; Stripe-Should-Retry: false is obeyed', async () => {
    plan = [{ status: 500 }]
    await expect(stripe().checkout.sessions.expire('cs_1')).rejects.toThrow()
    expect(requests).toHaveLength(1)
    requests.length = 0
    plan = [{ status: 500, headers: { 'stripe-should-retry': 'false' } }]
    await expect(
      stripe().paymentIntents.capture('pi_123', {}, { idempotencyKey: 'capture:43' }),
    ).rejects.toThrow()
    expect(requests).toHaveLength(1)
  })

  it('Stripe: a hung request times out instead of blocking the job', async () => {
    setGuardSettingsForTests('stripe', { timeoutMs: 50, retries: 1 })
    plan = [
      { status: 200, hang: true },
      { status: 200, hang: true },
    ]
    const started = Date.now()
    await expect(
      stripe().paymentIntents.capture('pi_123', {}, { idempotencyKey: 'capture:44' }),
    ).rejects.toThrow()
    expect(requests).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
