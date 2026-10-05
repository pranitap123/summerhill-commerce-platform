/**
 * HTTP security headers, the CSRF origin rule and the client-IP rule (G6-01, SECURITY §5).
 * Pure functions with no Next.js imports: `next.config.ts` (static headers), `src/proxy.ts`
 * (per-request CSP nonce, origin check) and `src/server/http.ts` (client IP) share them, and the
 * unit tests cover them without a server.
 */

export interface CspOptions {
  /** Per-request nonce: Next.js adds it to its own scripts; nothing else may run. */
  nonce: string
  /** `next dev` needs eval for React's debugging features and Fast Refresh. */
  dev: boolean
  /** Served over HTTPS: ask the browser to upgrade any stray http:// subresource. */
  https: boolean
}

/**
 * The page policy. Checkout and Connect onboarding are Stripe-hosted pages reached by top-level
 * navigation, which CSP doesn't govern, so no Stripe domain is allowed: nothing from Stripe loads
 * inside our pages. Adding Stripe.js or Elements later means adding `https://js.stripe.com` to
 * script-src and frame-src.
 */
export function pageCsp({ nonce, dev, https }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic': scripts loaded by a nonced script are trusted too (Next.js chunk loading);
    // CSP3 browsers ignore 'self' when it's present, older ones fall back to it.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // React, Radix and Payload's admin set inline style attributes; styles can't run code.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    // Payload's live preview frames the storefront from /admin (same origin); nobody else may.
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

/** JSON and file responses never render or frame anything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

/** Headers that are the same on every response (applied in next.config.ts). */
export function staticSecurityHeaders(opts: { production: boolean }): Array<{
  key: string
  value: string
}> {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Older browsers without frame-ancestors
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    // The camera is for the merchant console's barcode scanner (G4); nothing else is used.
    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), interest-cohort=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Nothing of ours is meant to be embedded by other sites (emails carry no images).
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    // Browsers ignore HSTS over plain HTTP, and a dev build must never pin localhost to HTTPS.
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

/**
 * CSRF defence for cookie-authenticated requests: a state-changing request from a browser must
 * come from our own origin. Browsers send `Origin` on every cross-origin request and on same-origin
 * POST/PUT/PATCH/DELETE; when it's missing, `Sec-Fetch-Site` still tells a cross-site request
 * apart. Requests with neither come from non-browser clients (Stripe, curl, tests), which carry no
 * ambient cookies to abuse.
 */
export function checkRequestOrigin(input: {
  method: string
  origin: string | null
  secFetchSite: string | null
  /** The Host (or X-Forwarded-Host) the request was sent to. */
  host: string | null
  /** NEXT_PUBLIC_SERVER_URL */
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
      } catch {
        // an invalid server URL is caught by config validation at boot
      }
    }
    if (allowed.has(url.origin)) return { ok: true }
    if (input.host && url.host === input.host.toLowerCase()) return { ok: true }
    return { ok: false, reason: `origin ${url.origin} not allowed` }
  }
  if (input.secFetchSite === 'cross-site') return { ok: false, reason: 'cross-site request' }
  return { ok: true }
}

/**
 * The client's address from X-Forwarded-For. Each proxy appends the address it received the request
 * from, so with `trustedHops` proxies in front of the app the client is the entry that many places
 * from the right; anything further left was written by the client and can't be trusted (it would
 * let one caller dodge per-IP rate limits by sending a new address each time). Without a proxy,
 * Next.js fills the header from the socket only when the client didn't send one, so an app exposed
 * directly can't know the real address, so a deployment puts a proxy in front (TRUSTED_PROXY_HOPS).
 */
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

/** A random nonce for the page CSP (128 bits, base64). */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
