import { getLogger } from './logger'

/**
 * The one wrapper for calls leaving the app (G6-05, SYSTEM_DESIGN §9): every call to Stripe,
 * Elasticsearch, SMTP and the app's own revalidation webhook goes through a guard that gives it
 *  - a timeout per attempt (the attempt's AbortSignal fires, and the call fails with
 *    OutboundTimeoutError)
 *  - retries with exponential backoff and full jitter, for idempotent calls only (reads, and
 *    Stripe writes that carry an Idempotency-Key); a write without one is tried once, because
 *    retrying it could do it twice
 *  - a circuit breaker per dependency: after `failureThreshold` failures in a row the circuit opens
 *    and calls fail at once with CircuitOpenError for `resetMs` (search falls back to Postgres
 *    straight away instead of waiting out a timeout on every request); then one trial call is let
 *    through, and its result closes or re-opens the circuit
 * Failures are network errors, timeouts and 5xx/429 answers. A 4xx is the caller's problem, not the
 * dependency's, so it neither retries nor trips the breaker.
 */
export type Dependency = 'stripe' | 'elasticsearch' | 'smtp' | 'revalidate'

export interface GuardSettings {
  timeoutMs: number
  retries: number
  failureThreshold: number
  resetMs: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULTS: Record<Dependency, GuardSettings> = {
  // Stripe's SDK timeout (30 s, src/modules/payments/stripe.ts) is the budget for all attempts.
  stripe: {
    timeoutMs: 10_000,
    retries: 2,
    failureThreshold: 5,
    resetMs: 30_000,
    baseDelayMs: 250,
    maxDelayMs: 2_000,
  },
  // Search has a Postgres fallback: fail fast, retry once, open quickly.
  elasticsearch: {
    timeoutMs: 3_000,
    retries: 1,
    failureThreshold: 3,
    resetMs: 15_000,
    baseDelayMs: 50,
    maxDelayMs: 300,
  },
  // Sending mail isn't idempotent; the outbox job retries a failed notification later.
  smtp: {
    timeoutMs: 15_000,
    retries: 0,
    failureThreshold: 5,
    resetMs: 60_000,
    baseDelayMs: 0,
    maxDelayMs: 0,
  },
  revalidate: {
    timeoutMs: 5_000,
    retries: 1,
    failureThreshold: 5,
    resetMs: 30_000,
    baseDelayMs: 100,
    maxDelayMs: 500,
  },
}

export class OutboundTimeoutError extends Error {
  readonly code = 'OUTBOUND_TIMEOUT'
  constructor(
    readonly dependency: Dependency,
    readonly timeoutMs: number,
  ) {
    super(`${dependency} did not answer within ${timeoutMs} ms`)
  }
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN'
  constructor(readonly dependency: Dependency) {
    super(`${dependency} is unavailable (circuit open); not calling it`)
  }
}

export interface CallOptions<T> {
  /** Safe to repeat: a read, or a write the dependency de-duplicates (idempotency key). */
  idempotent: boolean
  /** Overrides the dependency's per-attempt timeout (e.g. a bulk index write). */
  timeoutMs?: number
  /** A result that counts as a dependency failure (e.g. a 5xx response object). */
  failed?: (result: T) => boolean
  /** A failed result that must not be retried (e.g. Stripe-Should-Retry: false). */
  noRetry?: (result: T) => boolean
}

type State = 'closed' | 'open' | 'half_open'

/** Time, sleep and randomness, replaceable in tests. */
const clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  random: () => Math.random(),
}

export class Guard {
  private state: State = 'closed'
  private failures = 0
  private openedAt = 0
  private trialInFlight = false

  constructor(
    readonly dependency: Dependency,
    public settings: GuardSettings,
  ) {}

  get circuit(): State {
    return this.state
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>, call: CallOptions<T>): Promise<T> {
    const attempts = 1 + (call.idempotent ? this.settings.retries : 0)
    for (let attempt = 0; ; attempt++) {
      const trial = this.admit()
      let outcome: { ok: true; value: T } | { ok: false; error: unknown; value?: T }
      try {
        const value = await this.attempt(fn, call.timeoutMs ?? this.settings.timeoutMs)
        outcome = call.failed?.(value) ? { ok: false, error: null, value } : { ok: true, value }
      } catch (error) {
        outcome = { ok: false, error: isDependencyFailure(error) ? error : undefined }
        if (outcome.error === undefined) {
          // Not the dependency's fault (bad request, validation): report it, no breaker, no retry.
          this.settle(trial, true)
          throw error
        }
      }
      this.settle(trial, outcome.ok)
      if (outcome.ok) return outcome.value

      const last = attempt + 1 >= attempts
      const noRetry = outcome.value !== undefined && call.noRetry?.(outcome.value)
      if (last || noRetry || this.state === 'open') {
        if (outcome.value !== undefined) return outcome.value
        throw outcome.error
      }
      const cap = Math.min(this.settings.maxDelayMs, this.settings.baseDelayMs * 2 ** attempt)
      await clock.sleep(Math.round(clock.random() * cap))
    }
  }

  /** Throws when the circuit is open; returns whether this call is the half-open trial. */
  private admit(): boolean {
    if (this.state === 'closed') return false
    if (this.state === 'open' && clock.now() - this.openedAt >= this.settings.resetMs) {
      this.transition('half_open')
    }
    if (this.state === 'half_open' && !this.trialInFlight) {
      this.trialInFlight = true
      return true
    }
    throw new CircuitOpenError(this.dependency)
  }

  private settle(trial: boolean, ok: boolean) {
    if (trial) this.trialInFlight = false
    if (ok) {
      this.failures = 0
      if (this.state !== 'closed') this.transition('closed')
      return
    }
    this.failures++
    if (trial || this.failures >= this.settings.failureThreshold) {
      this.openedAt = clock.now()
      if (this.state !== 'open') this.transition('open')
    }
  }

  private async attempt<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new OutboundTimeoutError(this.dependency, timeoutMs)
        controller.abort(err)
        reject(err)
      }, timeoutMs)
    })
    try {
      return await Promise.race([fn(controller.signal), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private transition(to: State) {
    const from = this.state
    this.state = to
    const log = getLogger().child({ dependency: this.dependency, circuit: to })
    if (to === 'open') log.error({ from, failures: this.failures }, 'circuit opened')
    else log.warn({ from }, `circuit ${to === 'closed' ? 'closed' : 'half-open'}`)
  }
}

/** Errors that mean the dependency is unhealthy (as opposed to a rejected request). */
function isDependencyFailure(err: unknown): boolean {
  if (err instanceof OutboundTimeoutError) return true
  if (!(err instanceof Error)) return false
  const e = err as Error & { code?: string; statusCode?: number; status?: number; type?: string }
  const status = e.statusCode ?? e.status
  if (typeof status === 'number') return status >= 500 || status === 429
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  // Node/undici network errors, Stripe's connection error, the ES client's connection errors,
  // and nodemailer's connection/timeout codes.
  return (
    (e.name === 'TypeError' && e.message === 'fetch failed') ||
    e.type === 'StripeConnectionError' ||
    ['ConnectionError', 'TimeoutError', 'NoLivingConnectionsError'].includes(e.name) ||
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_\w+|ESOCKET|ECONNECTION|ETIMEOUT)$/.test(
      e.code ?? '',
    )
  )
}

const guards = new Map<Dependency, Guard>()

export function guard(dependency: Dependency): Guard {
  let g = guards.get(dependency)
  if (!g) {
    g = new Guard(dependency, { ...DEFAULTS[dependency] })
    guards.set(dependency, g)
  }
  return g
}

/** Circuit state of every dependency that has been called (for /api/ready and the ops page). */
export function circuitStates(): Partial<Record<Dependency, State>> {
  return Object.fromEntries([...guards].map(([d, g]) => [d, g.circuit]))
}

/**
 * A `fetch` that goes through the guard. `idempotent` decides per request whether it may be
 * retried (default: GET and HEAD only).
 */
export function guardedFetch(
  dependency: Dependency,
  idempotent: (method: string, headers: Headers) => boolean = (m) => m === 'GET' || m === 'HEAD',
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    return guard(dependency).run(
      (signal) =>
        fetch(input, {
          ...init,
          signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
        }),
      {
        idempotent: idempotent(method, headers),
        failed: (res) => res.status >= 500 || res.status === 429,
        noRetry: (res) => res.headers.get('stripe-should-retry') === 'false',
      },
    )
  }) as typeof fetch
}

/** Test helpers. */
export function resetGuardsForTests(dependency?: Dependency): void {
  if (dependency) guards.delete(dependency)
  else guards.clear()
}
export function setGuardSettingsForTests(dependency: Dependency, settings: Partial<GuardSettings>) {
  Object.assign(guard(dependency).settings, settings)
}
export function setOutboundClockForTests(overrides: Partial<typeof clock> | null): void {
  Object.assign(
    clock,
    overrides ?? {
      now: () => Date.now(),
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      random: () => Math.random(),
    },
  )
}
