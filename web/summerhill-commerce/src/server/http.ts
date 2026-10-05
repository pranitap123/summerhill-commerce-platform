import { randomUUID } from 'node:crypto'

import { type NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'

import type { Permission, SessionUser } from '@/modules/identity'
import type { StaffMembership } from '@/modules/merchant'
import type { Actor, AuditContext, AuditEntry } from '@/modules/ops'

import { getConfig } from './config'
import type { Db } from './db'
import { getLogger, type Logger } from './logger'
import { inSpan, SpanKind } from './tracing'
import { clientIpFrom } from './securityHeaders'

/**
 * Every API route is declared with a policy (G1-06, G1-16):
 *  - public    anyone
 *  - customer  a signed-in user
 *  - admin     platform staff (admin, support or finance, G5-01) holding the route's `permission`
 *              (SECURITY §4.1); a route without one is admin-only
 *  - staff     merchant staff (an active staff membership, G4-05) or an admin; the handler still
 *              checks that the order/location is in the caller's merchant scope
 *  - webhook   no session; the handler must verify the provider's signature itself
 * admin and staff also need a verified second factor for the session (G5-12, MFA_REQUIRED).
 * Every successful admin mutation is audited (G5-09): the handler records a specific entry with
 * `ctx.audit`, and if it didn't, `route()` records a generic one.
 * The authorisation matrix test (tests/authz) fails if a route handler isn't wrapped by `route()`
 * or declares a policy that doesn't match its path.
 */
export type Policy = 'public' | 'customer' | 'admin' | 'staff' | 'webhook'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

/** The single error format for every API response (SYSTEM_DESIGN §7.2). */
export interface ErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown }
}

export interface RouteContext<P> {
  req: NextRequest
  params: P
  user: SessionUser | null
  /** Active staff memberships of the caller (staff policy only; empty for admins without any). */
  memberships: StaffMembership[]
  log: Logger
  requestId: string
  /** Actor + request id + IP + user agent, for services that audit themselves. */
  auditContext: AuditContext
  /** Records an audit entry with the request context (pass a transaction to make it atomic). */
  audit(entry: Omit<AuditEntry, keyof AuditContext>, db?: Db): Promise<void>
}

type RouteHandler<P> = (ctx: RouteContext<P>) => Promise<Response | unknown>
type NextRouteContext<P> = { params: Promise<P> }

export type WrappedRoute<P> = ((
  req: NextRequest,
  ctx: NextRouteContext<P>,
) => Promise<Response>) & {
  policy: Policy
  permission: Permission | null
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

export interface RouteOptions {
  /**
   * Public routes only: load the session user when a session cookie or Authorization header is
   * present (cart, checkout and order pages work for guests and signed-in customers alike).
   */
  session?: 'optional'
  /** Admin routes: what the caller must be allowed to do (default: the admin role only). */
  permission?: Permission
  /**
   * 'service': the module service called by this route writes its own specific audit entry, so
   * route() doesn't add the generic one (G5-09).
   */
  audit?: 'service'
}

function actorFor(policy: Policy, user: SessionUser | null): Actor {
  if (!user) return { type: policy === 'webhook' ? 'stripe' : 'customer', id: null }
  if (policy === 'admin') return { type: 'admin', id: String(user.id) }
  if (policy === 'staff') return { type: 'merchant_staff', id: String(user.id) }
  return { type: 'customer', id: String(user.id) }
}

function hasSessionCredentials(req: NextRequest): boolean {
  return req.cookies.has('payload-token') || req.headers.has('authorization')
}

export function route<P = Record<string, never>>(
  policy: Policy,
  handler: RouteHandler<P>,
  options: RouteOptions = {},
): WrappedRoute<P> {
  const wrapped = (req: NextRequest, ctx: NextRouteContext<P>): Promise<Response> =>
    inSpan(
      `${req.method} ${req.nextUrl.pathname}`,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': req.method, 'url.path': req.nextUrl.pathname },
      },
      async (span) => {
        const response = await handle(req, ctx)
        span.setAttribute('http.response.status_code', response.status)
        return response
      },
    )
  const handle = async (req: NextRequest, ctx: NextRouteContext<P>): Promise<Response> => {
    const incoming = req.headers.get('x-request-id')
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID()
    const log = getLogger().child({ requestId, method: req.method, path: req.nextUrl.pathname })
    const started = Date.now()
    let response: Response
    let audited = false

    try {
      let user: SessionUser | null = null
      let memberships: StaffMembership[] = []
      if (policy === 'admin' || policy === 'customer' || policy === 'staff') {
        // Loaded on demand: identity pulls in the whole Payload config, which public routes
        // (health, catalogue) must not pay for in compile time or cold starts.
        const { getSessionUser, hasRole, isPlatformStaff, can } = await import('@/modules/identity')
        user = await getSessionUser(req.headers)
        if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required')
        if (policy === 'admin') {
          if (!isPlatformStaff(user))
            throw new HttpError(403, 'FORBIDDEN', 'Operations staff access required')
          if (!user.mfaVerified) throw mfaRequired()
          const allowed = options.permission
            ? can(user, options.permission)
            : hasRole(user, ['admin'])
          if (!allowed) throw new HttpError(403, 'FORBIDDEN', "Your role can't do this")
        }
        if (policy === 'staff') {
          const { listStaffMemberships } = await import('@/modules/merchant')
          memberships = await listStaffMemberships(String(user.id))
          if (!memberships.length && !hasRole(user, ['admin']))
            throw new HttpError(403, 'FORBIDDEN', 'Store staff access required')
          if (!user.mfaVerified) throw mfaRequired()
        }
      } else if (options.session === 'optional' && hasSessionCredentials(req)) {
        const { getSessionUser } = await import('@/modules/identity')
        user = await getSessionUser(req.headers)
      }
      const params = ((await ctx?.params) ?? {}) as P
      const auditContext: AuditContext = {
        actor: actorFor(policy, user),
        requestId,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent'),
      }
      const record = async (entry: Omit<AuditEntry, keyof AuditContext>, db?: Db) => {
        const [{ audit }, { getDb }] = await Promise.all([import('@/modules/ops'), import('./db')])
        await audit(db ?? getDb(), { ...auditContext, ...entry })
        audited = true
      }
      const result = await handler({
        req,
        params,
        user,
        memberships,
        log,
        requestId,
        auditContext,
        audit: record,
      })
      response = result instanceof Response ? result : NextResponse.json(result)
      if (
        policy === 'admin' &&
        isMutation(req.method) &&
        !audited &&
        options.audit !== 'service' &&
        response.status < 400
      )
        await record({
          action: `api.${req.method.toLowerCase()}`,
          targetType: 'api',
          targetId: req.nextUrl.pathname,
          data: { status: response.status, params: params as Record<string, unknown> },
        })
    } catch (err) {
      response = toErrorResponse(err, requestId, log)
    }

    try {
      response.headers.set('x-request-id', requestId)
    } catch {
      // Some Response objects have immutable headers; the id is still in the logs.
    }
    log.info({ status: response.status, durationMs: Date.now() - started }, 'request')
    return response
  }
  return Object.assign(wrapped, { policy, permission: options.permission ?? null })
}

const isMutation = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method)

const mfaRequired = () =>
  new HttpError(403, 'MFA_REQUIRED', 'Two-step verification is required for staff', {
    setupUrl: '/mfa',
  })

export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  const body: ErrorBody = {
    error: { code, message, requestId, ...(details !== undefined ? { details } : {}) },
  }
  return NextResponse.json(body, { status })
}

function toErrorResponse(err: unknown, requestId: string, log: Logger): Response {
  if (err instanceof HttpError) {
    if (err.status >= 500) log.error({ err }, err.message)
    const res = errorResponse(err.status, err.code, err.message, requestId, err.details)
    const retryAfter = (err.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds
    if (err.status === 429 && retryAfter) res.headers.set('retry-after', String(retryAfter))
    return res
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return errorResponse(400, 'VALIDATION_FAILED', 'Request is invalid', requestId, issues)
  }
  log.error({ err }, 'unhandled error')
  // Never leak internals in production (threat T9).
  const details = getConfig().isProduction
    ? undefined
    : err instanceof Error
      ? err.message
      : String(err)
  return errorResponse(500, 'INTERNAL', 'Something went wrong', requestId, details)
}

/** Parses a JSON body with a strict schema; unknown keys are rejected (GAP-10). */
export async function parseJson<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }
  return schema.parse(raw)
}

export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams))
}

export function parseParams<S extends z.ZodType>(params: unknown, schema: S): z.infer<S> {
  return schema.parse(params)
}

/**
 * Demo/test-only tools (simulated verification, the separate-charge demo) must not exist in
 * production: respond 404 there (G1-10).
 */
export function assertDemoToolsEnabled(): void {
  if (getConfig().isProduction) throw new HttpError(404, 'NOT_FOUND', 'Not found')
}

/** Client IP from the trusted part of the proxy chain (G6-01, see clientIpFrom). */
export function clientIp(req: NextRequest): string | null {
  return clientIpFrom(
    req.headers.get('x-forwarded-for'),
    req.headers.get('x-real-ip'),
    getConfig().TRUSTED_PROXY_HOPS,
  )
}

/** Shared schema for numeric path ids such as /api/admin/merchants/[id]. */
export const idParam = z.object({ id: z.coerce.number().int().positive() }).strict()
