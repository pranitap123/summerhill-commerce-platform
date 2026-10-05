import { type NextRequest, NextResponse } from 'next/server'

import { API_CSP, checkRequestOrigin, newNonce, pageCsp } from '@/server/securityHeaders'

/**
 * Runs before every page and API request (Next.js 16 renamed `middleware` to `proxy`):
 *  - CSRF (G6-01): a state-changing request from a browser must come from our own origin
 *  - staff areas (G1-06): requests without a Payload session cookie are stopped before any route
 *    code runs. A fast, coarse check only: every admin route and page still verifies the user's
 *    role itself (defence in depth), because a cookie can be present but expired or a customer's
 *  - Payload's /admin (G6-01): staff who signed in there are sent through the second factor first
 *  - Content-Security-Policy (G6-01): a fresh nonce per page request, which Next.js puts on its own
 *    scripts; API responses get a policy that allows nothing
 */
const SESSION_COOKIE = 'payload-token'
/** The "second factor verified" cookie (G5-12, src/modules/identity/mfa.ts). */
const MFA_COOKIE = 'mfa'
/** The operations console, the merchant console (G4-06) and their APIs. */
const STAFF_AREAS = ['/ops', '/api/admin', '/console', '/api/console']

/** Same rule as the pipeline's slugify (pipeline/catalog_pipeline/canonical.py). */
export function categorySlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'item'
  )
}

/**
 * Pre-G3 category links were /shop?category=<Category name>; they move to /shop/<slug> for good
 * (G3-13). Done here, before rendering, so the answer is a real 308 and not a streamed page.
 */
function legacyShopRedirect(req: NextRequest): NextResponse | null {
  const category = req.nextUrl.searchParams.get('category')
  if (req.nextUrl.pathname !== '/shop' || !category) return null
  const url = req.nextUrl.clone()
  url.searchParams.delete('category')
  url.pathname = `/shop/${categorySlug(category)}`
  return NextResponse.redirect(url, 308)
}

function apiError(status: number, code: string, message: string): NextResponse {
  const requestId = crypto.randomUUID()
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status, headers: { 'x-request-id': requestId, 'content-security-policy': API_CSP } },
  )
}

/** Payload's own pages that must stay reachable before the second factor. */
const ADMIN_OPEN = /^\/admin\/(login|logout|forgot|reset|verify|create-first-user)(\/|$)/

function gate(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')

  // Stripe's webhooks are server-to-server and verified by signature, not by origin.
  if (!pathname.startsWith('/api/webhooks/')) {
    const origin = checkRequestOrigin({
      method: req.method,
      origin: req.headers.get('origin'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      host: req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host,
      serverUrl: process.env.NEXT_PUBLIC_SERVER_URL,
    })
    if (!origin.ok) return apiError(403, 'CSRF_REJECTED', 'Cross-site request refused')
  }

  const legacy = legacyShopRedirect(req)
  if (legacy) return legacy

  if (STAFF_AREAS.some((prefix) => pathname.startsWith(prefix))) {
    if (req.cookies.has(SESSION_COOKIE)) return null
    if (isApi) return apiError(401, 'UNAUTHENTICATED', 'Sign in required')
    // Staff (store and platform) sign in on the storefront; Payload's /admin is the content CMS.
    const login = new URL('/login', req.url)
    login.searchParams.set('redirect', pathname + req.nextUrl.search)
    return NextResponse.redirect(login)
  }

  // Payload's admin checks the second factor itself (Users `access.admin`); this only saves a
  // signed-in admin from Payload's bare "unauthorised" page by sending them to /mfa first.
  if (
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    !ADMIN_OPEN.test(pathname) &&
    req.cookies.has(SESSION_COOKIE) &&
    !req.cookies.has(MFA_COOKIE)
  ) {
    const mfa = new URL('/mfa', req.url)
    mfa.searchParams.set('redirect', pathname + req.nextUrl.search)
    return NextResponse.redirect(mfa)
  }
  return null
}

export function proxy(req: NextRequest) {
  const stopped = gate(req)
  if (stopped) return stopped

  if (req.nextUrl.pathname.startsWith('/api/')) {
    const res = NextResponse.next()
    res.headers.set('content-security-policy', API_CSP)
    return res
  }
  const csp = pageCsp({
    nonce: newNonce(),
    dev: process.env.NODE_ENV === 'development',
    https: req.nextUrl.protocol === 'https:',
  })
  // Next.js reads the nonce from the request's CSP header while rendering.
  const headers = new Headers(req.headers)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  return res
}

export const config = {
  matcher: [
    // Everything except build assets and static files: those carry no scripts and take no input.
    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|txt|xml|map)$).*)',
  ],
}
