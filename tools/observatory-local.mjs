#!/usr/bin/env node
// Security-header grade for the local build (G6-01), using the scoring rules of the MDN HTTP
// Observatory (v2: https://developer.mozilla.org/en-US/observatory/docs/tests_and_scoring).
// The hosted Observatory only scans public HTTPS sites, so this applies the same per-test
// modifiers to the headers the running app actually sends.
//
//   npm run scan:headers                       against http://localhost:3000 (or E2E_BASE_URL)
//   node tools/observatory-local.mjs --min A   fail below grade A (default)
//
// Transport tests (HTTP→HTTPS redirection, HSTS over TLS) need a certificate and are reported as
// not applicable locally; the HSTS header value is still checked.
const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const minIdx = process.argv.indexOf('--min')
const MIN_GRADE = minIdx > 0 ? process.argv[minIdx + 1] : 'A'

const GRADES = [
  [100, 'A+'], [90, 'A'], [85, 'A-'], [80, 'B+'], [70, 'B'], [65, 'B-'], [60, 'C+'], [50, 'C'],
  [45, 'C-'], [40, 'D+'], [30, 'D'], [25, 'D-'], [0, 'F'],
]
const grade = (score) => GRADES.find(([min]) => score >= min)[1]
const gradeRank = (g) => GRADES.findIndex(([, name]) => name === g)

// Pages whose headers are graded (the hosted scanner grades the landing page; we check more).
const PAGES = ['/', '/shop', '/cart', '/login', '/find-order', '/stores', '/admin/login']

function parseCsp(header) {
  const policy = new Map()
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) policy.set(name.toLowerCase(), values)
  }
  return policy
}

function testCsp(headers) {
  const header = headers.get('content-security-policy')
  if (!header) return ['csp-not-implemented', -25]
  const p = parseCsp(header)
  const fallback = (d) => p.get(d) ?? p.get('default-src') ?? []
  const script = fallback('script-src')
  const style = fallback('style-src')
  const hasNonceOrHash = script.some((v) => /^'(nonce|sha(256|384|512))-/.test(v))
  // With a nonce/hash (and strict-dynamic), browsers ignore 'unsafe-inline' for scripts.
  const unsafeInlineScript = script.includes("'unsafe-inline'") && !hasNonceOrHash
  const insecure = (vals) => vals.some((v) => v === 'http:' || v.startsWith('http://') || v === '*')
  if (!p.has('default-src') && !p.has('script-src')) return ['csp-header-invalid', -25]
  if (unsafeInlineScript || script.includes('data:')) return ['csp-implemented-with-unsafe-inline', -20]
  if (insecure(script) || insecure(fallback('object-src'))) return ['csp-implemented-with-insecure-scheme', -20]
  if (script.includes("'unsafe-eval'")) return ['csp-implemented-with-unsafe-eval', -10]
  if (insecure(fallback('img-src')) || insecure(fallback('media-src'))) return ['csp-implemented-with-insecure-scheme-in-passive-content-only', -10]
  if (style.includes("'unsafe-inline'")) return ['csp-implemented-with-unsafe-inline-in-style-src-only', 0]
  if ((p.get('default-src') ?? []).join(' ') === "'none'") return ['csp-implemented-with-no-unsafe-default-src-none', 10]
  return ['csp-implemented-with-no-unsafe', 0]
}

function testXfo(headers) {
  const csp = headers.get('content-security-policy')
  const ancestors = csp ? parseCsp(csp).get('frame-ancestors') : undefined
  if (ancestors && !ancestors.includes('*')) return ['xfo-implemented-via-csp', 5]
  const xfo = headers.get('x-frame-options')?.toUpperCase()
  if (!xfo) return ['x-frame-options-not-implemented', -20]
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return ['x-frame-options-sameorigin-or-deny', 0]
  return ['x-frame-options-header-invalid', -20]
}

function testXcto(headers) {
  const v = headers.get('x-content-type-options')
  if (!v) return ['x-content-type-options-not-implemented', -5]
  return v.trim().toLowerCase() === 'nosniff'
    ? ['x-content-type-options-nosniff', 0]
    : ['x-content-type-options-header-invalid', -5]
}

function testReferrer(headers) {
  const v = headers.get('referrer-policy')
  if (!v) return ['referrer-policy-not-implemented', 0]
  const last = v.split(',').map((s) => s.trim().toLowerCase()).pop()
  if (['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes(last))
    return ['referrer-policy-private', 5]
  if (last === 'no-referrer-when-downgrade') return ['referrer-policy-no-referrer-when-downgrade', 0]
  if (['origin', 'origin-when-cross-origin', 'unsafe-url'].includes(last)) return ['referrer-policy-unsafe', -5]
  return ['referrer-policy-header-invalid', -5]
}

function testCors(headers) {
  const v = headers.get('access-control-allow-origin')
  if (!v) return ['cors-not-implemented', 0]
  if (v === '*' && headers.get('access-control-allow-credentials') === 'true')
    return ['cors-implemented-with-universal-access', -50]
  return ['cors-implemented-with-restricted-access', 0]
}

function testCorp(headers) {
  const v = headers.get('cross-origin-resource-policy')
  if (!v) return ['corp-not-implemented', 0]
  return ['same-origin', 'same-site', 'cross-origin'].includes(v.trim().toLowerCase())
    ? [`corp-implemented-with-${v.trim().toLowerCase()}`, 0]
    : ['corp-header-invalid', -5]
}

function testSri(html) {
  if (!html) return ['sri-not-implemented-response-not-html', 0]
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  const external = scripts.filter(([, src]) => /^(https?:)?\/\//.test(src) && !src.startsWith(BASE))
  if (!scripts.length) return ['sri-not-implemented-but-no-scripts-loaded', 0]
  if (!external.length) return ['sri-not-implemented-but-all-scripts-loaded-from-secure-origin', 0]
  const allIntegrity = external.every(([tag]) => /\bintegrity=/.test(tag))
  const allHttps = external.every(([, src]) => src.startsWith('https://') || src.startsWith('//'))
  if (allIntegrity && allHttps) return ['sri-implemented-and-external-scripts-loaded-securely', 5]
  if (allHttps) return ['sri-not-implemented-but-external-scripts-loaded-securely', -5]
  return ['sri-not-implemented-and-external-scripts-not-loaded-securely', -50]
}

/** Cookie test over every Set-Cookie seen (the hosted scanner only sees the landing page's). */
function testCookies(cookies, production) {
  if (!cookies.length) return ['cookies-not-found', 0]
  const attrs = (c) => c.split(';').slice(1).map((a) => a.trim().toLowerCase())
  const session = (c) => /^(payload-token|mfa|cart|.*sess.*|.*token.*)=/i.test(c)
  for (const c of cookies) {
    const a = attrs(c)
    const sameSite = a.find((x) => x.startsWith('samesite='))
    if (sameSite && !['samesite=lax', 'samesite=strict', 'samesite=none'].includes(sameSite))
      return ['cookies-samesite-flag-invalid', -20]
    if (session(c) && !a.includes('httponly')) return ['cookies-session-without-httponly-flag', -30]
    if (production && session(c) && !a.includes('secure')) return ['cookies-session-without-secure-flag', -40]
    if (production && !a.includes('secure')) return ['cookies-without-secure-flag', -20]
  }
  const allSameSite = cookies.every((c) => attrs(c).some((x) => x.startsWith('samesite=')))
  return allSameSite
    ? ['cookies-secure-with-httponly-sessions-and-samesite', 5]
    : ['cookies-secure-with-httponly-sessions', 0]
}

function checkHstsValue(headers) {
  const v = headers.get('strict-transport-security')
  if (!v) return 'missing'
  const maxAge = Number(/max-age=(\d+)/i.exec(v)?.[1] ?? 0)
  if (maxAge < 15_768_000) return `max-age ${maxAge} is under six months`
  if (!/includesubdomains/i.test(v) || !/preload/i.test(v)) return 'not preload-ready'
  return 'ok'
}

async function fetchPage(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' })
  const html = (res.headers.get('content-type') ?? '').includes('text/html') ? await res.text() : null
  return { path, res, html }
}

async function main() {
  try {
    await fetch(`${BASE}/api/health`)
  } catch {
    console.error(`No app answering at ${BASE}. Start it first (npm run build:sim && npm run start:sim).`)
    process.exit(2)
  }
  // Session-style cookies: the anonymous cart cookie comes from adding an item.
  const cookies = []
  const products = await (await fetch(`${BASE}/api/v1/products?limit=1`)).json().catch(() => null)
  const productId = products?.items?.[0]?.id
  if (productId) {
    const add = await fetch(`${BASE}/api/v1/cart/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, quantity: 1 }),
    })
    cookies.push(...add.headers.getSetCookie())
  }
  const production = !!(await fetchPage('/')).res.headers.get('strict-transport-security')

  let worst = null
  const failures = []
  for (const path of PAGES) {
    const { res, html } = await fetchPage(path)
    cookies.push(...res.headers.getSetCookie())
    const results = [
      testCsp(res.headers),
      testXfo(res.headers),
      testXcto(res.headers),
      testReferrer(res.headers),
      testCors(res.headers),
      testCorp(res.headers),
      testSri(html),
    ]
    const hsts = checkHstsValue(res.headers)
    if (production && hsts !== 'ok') failures.push(`${path}: Strict-Transport-Security ${hsts}`)
    if (res.status >= 400) failures.push(`${path}: HTTP ${res.status}`)
    worst = worst ?? { path, results }
    const score = (r) => 100 + r.reduce((s, [, m]) => s + m, 0)
    if (score(results) < score(worst.results)) worst = { path, results }
    console.log(`${path.padEnd(14)} ${results.map(([id, mod]) => `${id}(${mod >= 0 ? '+' : ''}${mod})`).join(' ')}`)
  }
  const cookie = testCookies(cookies, production)
  console.log(`cookies        ${cookie[0]}(${cookie[1] >= 0 ? '+' : ''}${cookie[1]})  [${cookies.map((c) => c.split('=')[0]).join(', ') || 'none'}]`)

  // Observatory: penalties first; bonuses only count when the score is already 90 or more.
  const all = [...worst.results, cookie]
  const base = 100 + all.filter(([, m]) => m < 0).reduce((s, [, m]) => s + m, 0)
  const bonus = base >= 90 ? all.filter(([, m]) => m > 0).reduce((s, [, m]) => s + m, 0) : 0
  const score = Math.max(0, base + bonus)
  console.log(`\nTransport (redirect to HTTPS, HSTS over TLS): not applicable over http://localhost`)
  console.log(`Score ${score} → grade ${grade(score)} (lowest page: ${worst.path}; minimum ${MIN_GRADE})`)
  for (const f of failures) console.log(`FAIL ${f}`)
  if (failures.length || gradeRank(grade(score)) > gradeRank(MIN_GRADE)) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
