import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const getSessionUser = vi.fn()
vi.mock('@/modules/identity', async () => {
  const roles = await vi.importActual<typeof import('@/modules/identity/roles')>(
    '@/modules/identity/roles',
  )
  const permissions = await vi.importActual<typeof import('@/modules/identity/permissions')>(
    '@/modules/identity/permissions',
  )
  return { ...roles, ...permissions, getSessionUser: (...a: unknown[]) => getSessionUser(...a) }
})

const audited: Array<Record<string, unknown>> = []
vi.mock('@/modules/ops', () => ({
  audit: async (_db: unknown, entry: Record<string, unknown>) => {
    audited.push(entry)
  },
}))
vi.mock('@/server/db', () => ({ getDb: () => ({ query: async () => ({ rows: [] }) }) }))

const { HttpError, parseJson, route } = await import('@/server/http')

const req = (body?: string, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/test', { method: body ? 'POST' : 'GET', body, headers })
const ctx = { params: Promise.resolve({}) }

describe('route() wrapper', () => {
  beforeEach(() => getSessionUser.mockReset())

  it('returns JSON and a request id on success', async () => {
    const res = await route('public', async () => ({ ok: true }))(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('propagates a well-formed incoming request id and ignores a malformed one', async () => {
    const good = await route('public', async () => ({}))(
      req(undefined, { 'x-request-id': 'abc12345-trace' }),
      ctx,
    )
    expect(good.headers.get('x-request-id')).toBe('abc12345-trace')
    const bad = await route('public', async () => ({}))(
      req(undefined, { 'x-request-id': '<script>' }),
      ctx,
    )
    expect(bad.headers.get('x-request-id')).not.toBe('<script>')
  })

  it('maps HttpError to the standard error envelope', async () => {
    const res = await route('public', async () => {
      throw new HttpError(409, 'ITEM_UNAVAILABLE', 'Gone', { productIds: ['a'] })
    })(req(), ctx)
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      message: 'Gone',
      details: { productIds: ['a'] },
    })
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'))
  })

  it('maps validation errors to 400 with field paths', async () => {
    const schema = z.object({ qty: z.number().int() }).strict()
    const res = await route('public', async ({ req: r }) => parseJson(r, schema))(
      req('{"qty":"1","extra":1}'),
      ctx,
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.map((d: { path: string }) => d.path)).toContain('qty')
  })

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await route('public', async ({ req: r }) => parseJson(r, z.object({})))(
      req('{not json'),
      ctx,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_JSON')
  })

  it('hides internals of unexpected errors behind a 500 INTERNAL', async () => {
    const res = await route('public', async () => {
      throw new Error('db exploded')
    })(req(), ctx)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('INTERNAL')
  })

  it.each([
    ['anonymous', 401, 'UNAUTHENTICATED', null],
    ['customer', 403, 'FORBIDDEN', { id: 1, email: 'c@example.com', roles: ['customer'] }],
  ])('admin policy: %s → %i %s', async (_, status, code, user) => {
    getSessionUser.mockResolvedValue(user)
    const handler = vi.fn(async () => ({ secret: true }))
    const res = await route('admin', handler)(req(), ctx)
    expect(res.status).toBe(status)
    expect((await res.json()).error.code).toBe(code)
    expect(handler).not.toHaveBeenCalled()
  })

  it('admin policy: admin reaches the handler', async () => {
    getSessionUser.mockResolvedValue({
      id: 1,
      email: 'a@example.com',
      roles: ['admin'],
      mfaVerified: true,
    })
    const res = await route('admin', async ({ user }) => ({ who: user?.roles }))(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ who: ['admin'] })
  })

  it('admin policy: no second factor → 403 MFA_REQUIRED, handler not called', async () => {
    getSessionUser.mockResolvedValue({ id: 1, email: 'a@example.com', roles: ['admin'] })
    const handler = vi.fn(async () => ({}))
    const res = await route('admin', handler)(req(), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({
      code: 'MFA_REQUIRED',
      details: { setupUrl: '/mfa' },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    ['support', 'refunds.create', 200],
    ['support', 'payouts.manage', 403],
    ['finance', 'payouts.manage', 200],
    ['finance', 'users.manage', 403],
    ['support', undefined, 403], // no permission declared: admin only
    ['admin', 'users.manage', 200],
  ] as const)('admin policy: %s with permission %s → %i', async (role, permission, status) => {
    getSessionUser.mockResolvedValue({
      id: 5,
      email: 'x@example.com',
      roles: [role],
      mfaVerified: true,
    })
    const r = route('admin', async () => ({ ok: true }), permission ? { permission } : {})
    expect(r.permission).toBe(permission ?? null)
    expect((await r(req(), ctx)).status).toBe(status)
  })

  describe('audit of admin mutations (G5-09)', () => {
    const admin = { id: 9, email: 'a@example.com', roles: ['admin'], mfaVerified: true }
    beforeEach(() => {
      audited.length = 0
      getSessionUser.mockResolvedValue(admin)
    })

    it('records a generic entry when the handler did not audit', async () => {
      const res = await route('admin', async () => ({ done: true }))(
        req('{}', { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest' }),
        ctx,
      )
      expect(res.status).toBe(200)
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({
        actor: { type: 'admin', id: '9' },
        action: 'api.post',
        targetType: 'api',
        targetId: '/api/test',
        ip: '203.0.113.9',
        userAgent: 'vitest',
      })
    })

    it('keeps only the specific entry when the handler audits itself', async () => {
      await route('admin', async ({ audit }) => {
        await audit({ action: 'thing.change', targetType: 'thing', targetId: 1 })
        return {}
      })(req('{}'), ctx)
      expect(audited.map((a) => a.action)).toEqual(['thing.change'])
    })

    it("trusts `audit: 'service'` routes and ignores reads and failed requests", async () => {
      await route('admin', async () => ({}), { audit: 'service' })(req('{}'), ctx)
      await route('admin', async () => ({}))(req(), ctx)
      await route('admin', async () => {
        throw new HttpError(422, 'NOPE', 'no')
      })(req('{}'), ctx)
      expect(audited).toHaveLength(0)
    })
  })

  it('public policy never looks up the session', async () => {
    await route('public', async () => ({}))(req(), ctx)
    expect(getSessionUser).not.toHaveBeenCalled()
  })
})
