import { describe, expect, it } from 'vitest'

import { parseConfig } from '@/server/config'
import {
  API_CSP,
  checkRequestOrigin,
  clientIpFrom,
  newNonce,
  pageCsp,
  staticSecurityHeaders,
} from '@/server/securityHeaders'

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name, values]
    }),
  )

describe('page CSP', () => {
  const nonce = 'abc123=='
  const prod = directives(pageCsp({ nonce, dev: false, https: true }))

  it('runs only nonced scripts and what they load, never inline or eval in production', () => {
    expect(prod['script-src']).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"])
    expect(prod['script-src']).not.toContain("'unsafe-inline'")
    expect(prod['script-src']).not.toContain("'unsafe-eval'")
  })

  it('allows eval only for next dev', () => {
    const dev = directives(pageCsp({ nonce, dev: true, https: false }))
    expect(dev['script-src']).toContain("'unsafe-eval'")
    expect(dev['upgrade-insecure-requests']).toBeUndefined()
    expect(prod['upgrade-insecure-requests']).toEqual([])
  })

  it('locks down framing, plugins, base URLs and form targets', () => {
    expect(prod['frame-ancestors']).toEqual(["'self'"])
    expect(prod['object-src']).toEqual(["'none'"])
    expect(prod['base-uri']).toEqual(["'self'"])
    expect(prod['form-action']).toEqual(["'self'"])
    expect(prod['default-src']).toEqual(["'self'"])
  })

  it('loads nothing from other origins (Stripe pages are top-level navigations)', () => {
    const all = Object.values(prod).flat()
    expect(all.filter((v) => /^https?:/.test(v))).toEqual([])
  })

  it('API responses allow nothing', () => {
    expect(directives(API_CSP)).toMatchObject({
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
    })
  })

  it('makes a fresh 128-bit nonce each time', () => {
    const a = newNonce()
    expect(Buffer.from(a, 'base64')).toHaveLength(16)
    expect(newNonce()).not.toBe(a)
  })
})

describe('static headers', () => {
  const get = (production: boolean) =>
    Object.fromEntries(staticSecurityHeaders({ production }).map((h) => [h.key, h.value]))

  it('sets the SECURITY §5 baseline', () => {
    const h = get(true)
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(h['Permissions-Policy']).toContain('camera=(self)')
    expect(h['Permissions-Policy']).toContain('geolocation=()')
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload')
  })

  it('never pins a development host to HTTPS', () => {
    expect(get(false)['Strict-Transport-Security']).toBeUndefined()
  })
})

describe('CSRF origin check', () => {
  const base = {
    method: 'POST',
    origin: null as string | null,
    secFetchSite: null as string | null,
    host: 'localhost:3000',
    serverUrl: 'http://localhost:3000',
  }

  it('lets safe methods through whatever their origin', () => {
    expect(checkRequestOrigin({ ...base, method: 'GET', origin: 'https://evil.example' }).ok).toBe(
      true,
    )
  })

  it('accepts our own origin, by server URL or by the host the request was sent to', () => {
    expect(checkRequestOrigin({ ...base, origin: 'http://localhost:3000' }).ok).toBe(true)
    expect(
      checkRequestOrigin({ ...base, origin: 'https://shop.example', host: 'shop.example' }).ok,
    ).toBe(true)
  })

  it('refuses other origins, opaque and malformed ones', () => {
    for (const origin of ['https://evil.example', 'http://localhost:3001', 'null', 'not a url'])
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
        expect(checkRequestOrigin({ ...base, method, origin }).ok).toBe(false)
  })

  it('refuses a cross-site request without Origin, allows non-browser clients', () => {
    expect(checkRequestOrigin({ ...base, secFetchSite: 'cross-site' }).ok).toBe(false)
    expect(checkRequestOrigin({ ...base, secFetchSite: 'same-origin' }).ok).toBe(true)
    expect(checkRequestOrigin(base).ok).toBe(true)
  })
})

describe('client IP behind proxies', () => {
  it('ignores addresses the client prepended to X-Forwarded-For', () => {
    expect(clientIpFrom('6.6.6.6, 203.0.113.9', null, 1)).toBe('203.0.113.9')
    expect(clientIpFrom('6.6.6.6, 203.0.113.9, 10.0.0.2', null, 2)).toBe('203.0.113.9')
  })

  it('handles short chains, a missing header and x-real-ip', () => {
    expect(clientIpFrom('203.0.113.9', null, 3)).toBe('203.0.113.9')
    expect(clientIpFrom(null, ' 198.51.100.1 ', 1)).toBe('198.51.100.1')
    expect(clientIpFrom(' , ', null, 1)).toBeNull()
  })
})

describe('config', () => {
  const env = {
    DATABASE_URL: 'postgres://u:p@localhost/db',
    PAYLOAD_SECRET: 'x',
    STRIPE_SECRET_KEY: 'sk_test_x',
    NODE_ENV: 'production',
  }

  it('requires HTTPS in production except on localhost', () => {
    expect(() => parseConfig({ ...env, NEXT_PUBLIC_SERVER_URL: 'http://shop.example' })).toThrow(
      /must use https/,
    )
    expect(
      parseConfig({ ...env, NEXT_PUBLIC_SERVER_URL: 'https://shop.example' }).isProduction,
    ).toBe(true)
    expect(
      parseConfig({ ...env, NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000' }).isProduction,
    ).toBe(true)
  })

  it('trusts one proxy hop by default', () => {
    expect(
      parseConfig({ ...env, NEXT_PUBLIC_SERVER_URL: 'https://shop.example' }).TRUSTED_PROXY_HOPS,
    ).toBe(1)
  })
})
