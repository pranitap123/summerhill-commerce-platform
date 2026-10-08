import { type NextRequest, NextResponse } from 'next/server'

import { API_CSP, checkRequestOrigin, newNonce, pageCsp } from '@/server/securityHeaders'

const SESSION_COOKIE = 'payload-token'

const MFA_COOKIE = 'mfa'

const STAFF_AREAS = ['/ops', '/api/admin', '/console', '/api/console']

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

const ADMIN_OPEN = /^\/admin\/(login|logout|forgot|reset|verify|create-first-user)(\/|$)/

function gate(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')

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

    const login = new URL('/login', req.url)
    login.searchParams.set('redirect', pathname + req.nextUrl.search)
    return NextResponse.redirect(login)
  }

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

  const headers = new Headers(req.headers)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  return res
}

export const config = {
  matcher: [

    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|txt|xml|map)$).*)',
  ],
}
