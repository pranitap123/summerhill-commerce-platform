export interface CspOptions {
  nonce: string

  dev: boolean

  https: boolean
}

export function pageCsp({ nonce, dev, https }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],

    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],

    'frame-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  }
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`)
  if (https) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

export function staticSecurityHeaders(opts: { production: boolean }): Array<{
  key: string
  value: string
}> {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },

    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), interest-cohort=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },

    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },

    ...(opts.production
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]
      : []),
  ]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const isMutatingMethod = (method: string) => !SAFE_METHODS.has(method.toUpperCase())

export function checkRequestOrigin(input: {
  method: string
  origin: string | null
  secFetchSite: string | null

  host: string | null

  serverUrl: string | undefined
}): { ok: true } | { ok: false; reason: string } {
  if (!isMutatingMethod(input.method)) return { ok: true }
  if (input.origin) {
    if (input.origin === 'null') return { ok: false, reason: 'opaque origin' }
    let url: URL
    try {
      url = new URL(input.origin)
    } catch {
      return { ok: false, reason: 'malformed origin' }
    }
    const allowed = new Set<string>()
    if (input.serverUrl) {
      try {
        allowed.add(new URL(input.serverUrl).origin)
      } catch {}
    }
    if (allowed.has(url.origin)) return { ok: true }
    if (input.host && url.host === input.host.toLowerCase()) return { ok: true }
    return { ok: false, reason: `origin ${url.origin} not allowed` }
  }
  if (input.secFetchSite === 'cross-site') return { ok: false, reason: 'cross-site request' }
  return { ok: true }
}

export function clientIpFrom(
  forwardedFor: string | null,
  realIp: string | null,
  trustedHops: number,
): string | null {
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (hops.length) return hops[Math.max(0, hops.length - Math.max(1, trustedHops))]
  return realIp?.trim() || null
}

export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
