import fs from 'node:fs'
import path from 'node:path'

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PERMISSIONS } from '@/modules/identity/permissions'

const getSessionUser = vi.fn()
vi.mock('@/modules/identity', async () => {
  const roles = await vi.importActual<typeof import('@/modules/identity/roles')>(
    '@/modules/identity/roles',
  )
  const permissions = await vi.importActual<typeof import('@/modules/identity/permissions')>(
    '@/modules/identity/permissions',
  )
  return {
    ...roles,
    ...permissions,
    getSessionUser: (...a: unknown[]) => getSessionUser(...a),

    getMfaStatus: vi.fn(async () => ({ enrolled: false, confirmed: false })),
    beginEnrolment: vi.fn(async () => ({ secret: 'X', otpauthUri: 'otpauth://x' })),
    verifyMfaCode: vi.fn(async () => {}),
    mfaCookieValue: vi.fn(() => ({ value: 'x', maxAgeSeconds: 1 })),
    MFA_COOKIE: 'mfa',
    listTeam: vi.fn(async () => []),
    inviteUser: vi.fn(async () => ({})),
    changeRoles: vi.fn(async () => ({})),
    deactivateUser: vi.fn(async () => ({})),
    reactivateUser: vi.fn(async () => ({})),
    resetUserMfa: vi.fn(async () => {}),
    setMembership: vi.fn(async () => {}),
    removeMembership: vi.fn(async () => {}),
  }
})
const listStaffMemberships = vi.fn(async (): Promise<unknown[]> => [])
vi.mock('@/modules/merchant', async () => {
  const staff = await vi.importActual<typeof import('@/modules/merchant/staff')>(
    '@/modules/merchant/staff',
  )
  return {
    getMerchantById: vi.fn(async () => null),
    getLocation: vi.fn(async () => null),
    listStaffMemberships: (...a: unknown[]) => listStaffMemberships(...(a as [])),
    roleAtLeast: staff.roleAtLeast,
    STAFF_ROLES: staff.STAFF_ROLES,
    listMerchants: vi.fn(async () => []),
    updateMerchantStatus: vi.fn(),
    updateMerchantStripeAccount: vi.fn(),
    deriveOnboardingStatus: vi.fn(),
    createMerchant: vi.fn(async () => ({ id: 1 })),
    changeLifecycle: vi.fn(async () => ({ before: {}, after: {} })),
    merchantHealth: vi.fn(async () => ({})),
    stripeTestFixtures: {},
  }
})
const stripeReached = () => {
  throw new Error('Stripe must not be reached in the authz matrix')
}

vi.mock('@/modules/payments', () => ({
  getStripe: stripeReached,
  getOrderLedger: vi.fn(async () => []),
  getPaymentForOrder: vi.fn(async () => null),
  voidOrder: vi.fn(async () => ({ publicId: 'SH-TEST00', status: 'cancelled' })),
  projectCapture: vi.fn(async () => ({
    final: { totalCents: 0 },
    plan: { amountToCaptureCents: 0 },
    ceilingCents: 0,
  })),
  fastForwardToPicked: vi.fn(async () => {}),
  startCheckout: stripeReached,
  simulateCheckout: vi.fn(async () => ({ outcome: 'declined', message: 'test' })),
  recordWebhookEvent: vi.fn(async () => 'recorded'),
  verifyWebhook: stripeReached,
  completeSimulatedOnboarding: vi.fn(async () => null),
  createRefund: vi.fn(async () => ({})),
  cancelOnBehalf: vi.fn(async () => ({ order: {}, refund: null })),
  refundableSummary: vi.fn(async () => ({})),
  refundsByAgent: vi.fn(async () => []),
  listRefundsForOrder: vi.fn(async () => []),
  listDisputes: vi.fn(async () => []),
  getDispute: vi.fn(async () => null),
  buildEvidencePack: vi.fn(async () => ({})),
  submitDisputeEvidence: vi.fn(async () => ({})),
  setDisputeLiability: vi.fn(async () => ({})),
}))
vi.mock('@/modules/payouts', () => ({
  listPayouts: vi.fn(async () => []),
  requestPayout: vi.fn(async () => ({})),
  approvePayout: vi.fn(async () => ({})),
  merchantBalance: vi.fn(async () => ({})),
  setPayoutSchedule: vi.fn(async () => {}),
  finishOffboarding: vi.fn(async () => ({})),
  startOnboarding: vi.fn(async () => ({})),
  refreshAccountStatus: vi.fn(async () => ({})),
  merchantStatement: vi.fn(async () => ({ lines: [] })),
  statementCsv: vi.fn(() => ''),
  statementMonths: vi.fn(async () => []),
  listReconRuns: vi.fn(async () => []),
  runReconciliation: vi.fn(async () => null),
  getReconRun: vi.fn(async () => null),
  monthlyCloseCsv: vi.fn(async () => ''),
  businessDayBounds: vi.fn(() => ({ from: new Date(0), to: new Date(0) })),
}))
vi.mock('@/modules/support', () => ({
  ISSUE_TYPES: ['missing', 'damaged', 'wrong_item', 'quality', 'other'],
  listIssues: vi.fn(async () => []),
  issueContext: vi.fn(async () => ({})),
  resolveIssue: vi.fn(async () => ({})),
  reportIssue: vi.fn(async () => ({})),
  canReportIssue: vi.fn(() => false),
}))
vi.mock('@/modules/reporting', () => ({
  searchOrders: vi.fn(async () => []),
  orderDossier: vi.fn(async () => null),
  computeMetrics: vi.fn(async () => ({})),
  METRIC_DEFINITIONS: {},
}))
vi.mock('@/modules/privacy', () => ({
  exportPersonalData: vi.fn(async () => ({})),
  deletePersonalData: vi.fn(async () => ({})),
  listPrivacyRequests: vi.fn(async () => []),
}))
vi.mock('@/modules/catalog', () => ({
  listIngestRuns: vi.fn(async () => []),
  getIngestRun: vi.fn(async () => null),
  listIngestRequests: vi.fn(async () => []),
  decideHeldRun: vi.fn(async () => ({})),
  requestIngestRun: vi.fn(async () => 1),
  listCategoryMappings: vi.fn(async () => []),
  listSubcategories: vi.fn(async () => []),
  setCategoryMapping: vi.fn(async () => ({})),
  getProduct: vi.fn(async () => null),
  resolveProduct: vi.fn(async () => null),
  listCategories: vi.fn(async () => []),
  listMerchants: vi.fn(async () => []),
  setProductOverride: vi.fn(async () => ({})),
  clearProductOverride: vi.fn(async () => false),
  OverrideTargetNotFound: class extends Error {},
  getProductsByIds: vi.fn(async () => []),
  getPricingProducts: vi.fn(async () => []),
  getProductOwner: vi.fn(async () => null),
  getProductsByUpc: vi.fn(async () => []),
  suggestReplacements: vi.fn(async () => []),
  setCategoryAvailability: vi.fn(async () => 0),
  listAvailabilityToggles: vi.fn(async () => ({ products: [], categories: [] })),
}))
vi.mock('@/modules/search', () => ({
  findProducts: vi.fn(async () => ({ items: [], total: 0 })),
  recordSearchClick: vi.fn(async () => false),
  searchReport: vi.fn(async () => ({})),
  pingSearch: vi.fn(async () => false),
  searchIndexExists: vi.fn(async () => false),
}))
vi.mock('@/server/db', () => {
  const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }
  return { getDb: () => db, withTransaction: (fn: (tx: typeof db) => unknown) => fn(db) }
})

const APP_DIR = path.resolve(__dirname, '../../src/app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const EXTERNAL: Record<string, string> = {
  '(payload)/api/[...slug]': 'Payload REST API: Payload enforces collection access control',
  '(payload)/api/graphql': 'Payload GraphQL: Payload enforces collection access control',
  '(payload)/api/graphql-playground':
    'Payload GraphQL playground (disabled in production by Payload)',
  '(app)/next/preview': 'Payload template draft preview: checks PREVIEW_SECRET; reworked in G3-13',
  '(app)/next/exit-preview':
    'Payload template: only clears the draft-mode cookie; reworked in G3-13',
}

const PUBLIC = new Set([
  'api/products',
  'api/products/[id]',
  'api/products/search',
  'api/categories',
  'api/health',

  'api/v1/categories',
  'api/v1/merchants',
  'api/v1/products',
  'api/v1/products/[slug]',
  'api/v1/search',
  'api/v1/search/clicks',
  'api/ready',

  'api/v1/cart',
  'api/v1/cart/items',
  'api/v1/cart/items/[lineId]',
  'api/v1/cart/quote',
  'api/v1/checkout',
  'api/v1/orders/[publicId]', // owner session or signed guest link, else 404
  'api/v1/orders/lookup', // same response for every input; rate-limited

  'api/v1/cart/slots',
  'api/v1/cart/items/[lineId]/replacements',

  'api/v1/orders/[publicId]/cancel',
  'api/v1/orders/[publicId]/substitutions/[lineId]',
  'api/v1/orders/[publicId]/arrived',
  'api/v1/orders/[publicId]/rating',
  'api/v1/orders/[publicId]/reorder',

  'api/simulator/checkout/[sessionId]',
  'api/simulator/onboarding/[accountId]', // G5-02, same rule

  'api/v1/status',

  'api/v1/orders/[publicId]/issues',
])

function expectedPolicy(routePath: string): string | null {
  if (routePath.startsWith('api/admin/')) return 'admin'
  if (routePath.startsWith('api/console/')) return 'staff'
  if (routePath.startsWith('api/webhooks/')) return 'webhook'
  if (routePath.startsWith('api/v1/me/')) return 'customer'
  if (PUBLIC.has(routePath)) return 'public'
  return null
}

function findRoutes(dir: string, base = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) return findRoutes(path.join(dir, e.name), rel)
    return e.name === 'route.ts' ? [base] : []
  })
}

const routes = findRoutes(APP_DIR).sort()
const ownRoutes = routes.filter((r) => !(r in EXTERNAL))

describe('route registry', () => {
  it('finds the routes (sanity check)', () => {
    expect(ownRoutes.length).toBeGreaterThanOrEqual(14)
  })

  it('every EXTERNAL entry still exists (the list must not rot)', () => {
    for (const r of Object.keys(EXTERNAL)) expect(routes, `stale EXTERNAL entry ${r}`).toContain(r)
  })

  it.each(ownRoutes)(
    '%s: every handler is wrapped by route() with the policy its path requires',
    async (r) => {
      const expected = expectedPolicy(r)
      expect(
        expected,
        `no policy rule for "${r}": add it to PUBLIC or put it under api/admin|api/console|api/webhooks`,
      ).not.toBeNull()
      const mod = await import(path.join(APP_DIR, r, 'route.ts'))
      const handlers = METHODS.filter((m) => typeof mod[m] === 'function')
      expect(handlers.length, `${r} exports no HTTP handlers`).toBeGreaterThan(0)
      for (const m of handlers)
        expect(mod[m].policy, `${r} ${m} is not wrapped by route()`).toBe(expected)
    },
  )
})

const adminRoutes = ownRoutes.filter((r) => expectedPolicy(r) === 'admin')
const staffRoutes = ownRoutes.filter((r) => expectedPolicy(r) === 'staff')
const customerRoutes = ownRoutes.filter((r) => expectedPolicy(r) === 'customer')

const users = {
  anonymous: null,
  customer: { id: 2, email: 'customer@example.com', roles: ['customer'], mfaVerified: true },
  support: { id: 3, email: 'support@example.com', roles: ['support'], mfaVerified: true },
  finance: { id: 4, email: 'finance@example.com', roles: ['finance'], mfaVerified: true },
  admin: { id: 1, email: 'admin@example.com', roles: ['admin'], mfaVerified: true },
}

const ADMIN_PARAMS = { id: '1', month: '2026-09', key: 'checkout.enabled', merchantId: '1' }
const fill = (r: string, params: Record<string, string>) =>
  Object.entries(params).reduce((u, [k, v]) => u.replace(`[${k}]`, v), `http://localhost/${r}`)

async function callAll(
  r: string,
  params: Record<string, string>,
): Promise<Array<[string, Response]>> {
  const mod = await import(path.join(APP_DIR, r, 'route.ts'))
  const out: Array<[string, Response]> = []
  for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
    const req = new NextRequest(fill(r, params), {
      method,
      ...(method === 'GET' || method === 'DELETE'
        ? {}
        : { body: '{}', headers: { 'content-type': 'application/json' } }),
    })
    out.push([method, await mod[method](req, { params: Promise.resolve(params) })])
  }
  return out
}

describe('admin routes × roles (G5-01, SECURITY §4.1)', () => {
  beforeEach(() => getSessionUser.mockReset())

  const roles = ['anonymous', 'customer', 'support', 'finance', 'admin'] as const
  const cases = adminRoutes.flatMap((r) => roles.map((role) => [r, role] as const))

  it.each(cases)('%s as %s', async (r, role) => {
    getSessionUser.mockResolvedValue(users[role])
    const mod = await import(path.join(APP_DIR, r, 'route.ts'))
    for (const [method, res] of await callAll(r, ADMIN_PARAMS)) {
      const permission = mod[method].permission as keyof typeof PERMISSIONS | null
      const allowed =
        role !== 'anonymous' &&
        role !== 'customer' &&
        (permission
          ? (PERMISSIONS[permission] as readonly string[]).includes(role)
          : role === 'admin')
      if (role === 'anonymous') expect(res.status, `${method} ${r}`).toBe(401)
      else if (!allowed) {
        expect(res.status, `${method} ${r} must refuse ${role}`).toBe(403)
        expect((await res.json()).error.code).toBe('FORBIDDEN')
      } else expect([401, 403], `${method} ${r} must let ${role} through`).not.toContain(res.status)
    }
  })

  it('every admin route declares a known permission or is admin-only', async () => {
    for (const r of adminRoutes) {
      const mod = await import(path.join(APP_DIR, r, 'route.ts'))
      for (const m of METHODS.filter((x) => typeof mod[x] === 'function'))
        expect(mod[m].permission === null || mod[m].permission in PERMISSIONS, `${m} ${r}`).toBe(
          true,
        )
    }
  })

  it.each(adminRoutes)('%s: an admin without a second factor gets MFA_REQUIRED', async (r) => {
    getSessionUser.mockResolvedValue({ ...users.admin, mfaVerified: false })
    for (const [method, res] of await callAll(r, ADMIN_PARAMS)) {
      expect(res.status, `${method} ${r}`).toBe(403)
      expect((await res.json()).error.code).toBe('MFA_REQUIRED')
    }
  })
})

describe('customer routes × roles', () => {
  beforeEach(() => getSessionUser.mockReset())

  it('there is at least one customer route (sanity check)', () => {
    expect(customerRoutes.length).toBeGreaterThan(0)
  })

  it.each(customerRoutes)('%s: anonymous → 401, customer and admin pass the gate', async (r) => {
    const mod = await import(path.join(APP_DIR, r, 'route.ts'))
    for (const role of ['anonymous', 'customer', 'admin'] as const) {
      getSessionUser.mockResolvedValue(users[role])
      for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
        const res: Response = await mod[method](
          new NextRequest(`http://localhost/${r}`, { method }),
          {
            params: Promise.resolve({}),
          },
        )
        if (role === 'anonymous') expect(res.status, `${method} ${r}`).toBe(401)
        else expect([401, 403], `${method} ${r} as ${role}`).not.toContain(res.status)
      }
    }
  })
})

const STAFF_PARAMS = {
  id: '1',
  month: '2026-09',
  publicId: 'SH-ABC234',
  lineId: '1',
  date: '2026-12-25',
  productId: 'DEMO-0001',
  categoryId: '1',
}

describe('merchant console routes × roles (G4-05)', () => {
  beforeEach(() => {
    getSessionUser.mockReset()
    listStaffMemberships.mockReset()
    listStaffMemberships.mockResolvedValue([])
  })

  it('there are console routes (sanity check)', () => {
    expect(staffRoutes.length).toBeGreaterThanOrEqual(15)
  })

  const picker = {
    id: 7,
    userId: '7',
    merchantId: 1,
    merchantName: 'Demo Market',
    locationId: null,
    role: 'picker',
  }
  const cases = staffRoutes.flatMap((r) =>
    (['anonymous', 'customer', 'staff', 'admin'] as const).map((role) => [r, role] as const),
  )

  it.each(cases)('%s as %s', async (r, role) => {
    getSessionUser.mockResolvedValue(
      role === 'staff'
        ? { id: 7, email: 'picker@example.com', roles: ['customer'], mfaVerified: true }
        : users[role],
    )
    if (role === 'staff') listStaffMemberships.mockResolvedValue([picker])
    const mod = await import(path.join(APP_DIR, r, 'route.ts'))
    for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
      let url = `http://localhost/${r}`
      for (const [k, v] of Object.entries(STAFF_PARAMS)) url = url.replace(`[${k}]`, v)
      const req = new NextRequest(url, {
        method,
        ...(method === 'GET' || method === 'DELETE'
          ? {}
          : { body: '{}', headers: { 'content-type': 'application/json' } }),
      })
      const res: Response = await mod[method](req, { params: Promise.resolve(STAFF_PARAMS) })
      if (role === 'anonymous') expect(res.status, `${method} ${r}`).toBe(401)
      else if (role === 'customer') {
        expect(res.status, `${method} ${r}`).toBe(403)
        expect((await res.json()).error.code).toBe('FORBIDDEN')
      } else
        expect([401, 403], `${method} ${r} must let ${role} through the gate`).not.toContain(
          res.status,
        )
    }
  })

  it.each(staffRoutes)('%s: store staff without a second factor get MFA_REQUIRED', async (r) => {
    getSessionUser.mockResolvedValue({ id: 7, email: 'picker@example.com', roles: ['customer'] })
    listStaffMemberships.mockResolvedValue([picker])
    for (const [method, res] of await callAll(r, STAFF_PARAMS)) {
      expect(res.status, `${method} ${r}`).toBe(403)
      expect((await res.json()).error.code).toBe('MFA_REQUIRED')
    }
  })
})
