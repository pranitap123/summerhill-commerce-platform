import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { categorySlug, config, proxy } from '@/proxy'

// src/proxy.ts: the coarse first gate in front of /ops, /api/admin and the merchant console (G1-06,
// G4-06), the permanent redirect of pre-G3 /shop?category=<name> links (G3-13), and the CSP nonce,
// CSRF origin check and Payload-admin second factor (G6-01).
describe('proxy', () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined)

  it('runs for pages and APIs, not for build assets and static files', () => {
    const [source] = config.matcher
    const matches = (path: string) => new RegExp(`^${source}$`).test(path)
    for (const path of [
      '/',
      '/shop',
      '/ops/orders',
      '/api/v1/cart',
      '/admin',
      '/api/webhooks/stripe',
    ])
      expect(matches(path), path).toBe(true)
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.svg', '/robots.txt'])
      expect(matches(path), path).toBe(false)
  })

  it('gives every page its own nonce, forwarded to Next.js in the request CSP', () => {
    const a = proxy(req('/'))
    const b = proxy(req('/'))
    const csp = a.headers.get('content-security-policy')!
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
    expect(b.headers.get('content-security-policy')).not.toBe(csp)
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
  })

  it('gives API responses a policy that allows nothing', () => {
    const res = proxy(req('/api/v1/cart'))
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('refuses cross-site state changes (CSRF), but not Stripe webhooks or safe reads', async () => {
    const post = (path: string, headers: Record<string, string>) =>
      proxy(new NextRequest(`http://localhost${path}`, { method: 'POST', headers }))
    const res = post('/api/v1/checkout', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('CSRF_REJECTED')
    expect(post('/api/users/login', { 'sec-fetch-site': 'cross-site' }).status).toBe(403)
    expect(post('/api/v1/checkout', { origin: 'http://localhost' }).status).toBe(200)
    expect(post('/api/webhooks/stripe', { origin: 'https://evil.example' }).status).toBe(200)
    const read = proxy(
      new NextRequest('http://localhost/api/v1/cart', {
        headers: { origin: 'https://evil.example' },
      }),
    )
    expect(read.status).toBe(200)
  })

  it("sends a signed-in admin through the second factor before Payload's /admin", () => {
    const res = proxy(req('/admin/collections/pages', 'payload-token=abc'))
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/mfa')
    expect(location.searchParams.get('redirect')).toBe('/admin/collections/pages')
    expect(proxy(req('/admin', 'payload-token=abc; mfa=signed')).status).toBe(200)
    expect(proxy(req('/admin/login', 'payload-token=abc')).status).toBe(200)
    expect(proxy(req('/admin/login')).status).toBe(200)
  })

  it('sends store staff to the storefront login for the merchant console (G4-06)', async () => {
    const page = proxy(req('/console/orders/SH-ABC234'))
    expect(new URL(page.headers.get('location')!).pathname).toBe('/login')
    const api = proxy(req('/api/console/locations'))
    expect(api.status).toBe(401)
  })

  it('moves legacy category links to the category page for good, keeping other filters', () => {
    const res = proxy(req('/shop?category=Dairy%20%26%20Eggs&organic=1'))
    expect(res.status).toBe(308)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/shop/dairy-eggs')
    expect(location.search).toBe('?organic=1')
    expect(proxy(req('/shop?q=milk')).headers.get('x-middleware-next')).toBe('1')
  })

  it('slugs category names exactly like the pipeline', () => {
    expect(categorySlug('Snacks & Treats')).toBe('snacks-treats')
    expect(categorySlug('Crème Brûlée')).toBe('creme-brulee')
    expect(categorySlug('!!!')).toBe('item')
  })

  it('answers API calls without a session with 401 JSON', async () => {
    const res = proxy(req('/api/admin/merchants'))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED')
  })

  it('redirects pages without a session to the login page, keeping the target', () => {
    const res = proxy(req('/ops/merchants?tab=1'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('redirect')).toBe('/ops/merchants?tab=1')
  })

  it('lets requests with a session cookie through (roles are checked by the route itself)', () => {
    const res = proxy(req('/api/admin/merchants', 'payload-token=abc'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
