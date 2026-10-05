/**
 * Lighthouse CI performance budgets (G6-07, ARC-perf) for the storefront, run against a local
 * production build (`npm run build:sim && npm run start:sim`, then `npm run test:lighthouse`).
 * Median of 3 runs per page, mobile emulation with Lighthouse's default throttling. The budgets are
 * enforced: a regression past any of them fails the run.
 */
const BASE = process.env.LHCI_BASE_URL ?? 'http://localhost:3000'

module.exports = {
  ci: {
    collect: {
      url: [
        `${BASE}/`,
        `${BASE}/shop`,
        `${BASE}/shop/produce`,
        `${BASE}/products/harbour-kitchen-honeycrisp-apples-5cdeeb`,
        `${BASE}/cart`,
      ],
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
        // Lighthouse's mobile preset slows the CPU 4× on top of the machine's own speed, calibrated
        // for a typical laptop (benchmark index ~1000+). On a much slower machine set
        // LHCI_CPU_SLOWDOWN=1 (see Lighthouse's throttling docs); the budgets stay the same.
        throttling: { cpuSlowdownMultiplier: Number(process.env.LHCI_CPU_SLOWDOWN ?? 4) },
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      assertions: {
        // Scores (0–1)
        'categories:performance': ['error', { minScore: 0.8, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:seo': ['warn', { minScore: 0.9, aggregationMethod: 'median-run' }],
        // Core Web Vitals and loading metrics (ms, unitless for CLS)
        'largest-contentful-paint': [
          'error',
          { maxNumericValue: 3000, aggregationMethod: 'median-run' },
        ],
        'cumulative-layout-shift': [
          'error',
          { maxNumericValue: 0.1, aggregationMethod: 'median-run' },
        ],
        'total-blocking-time': ['error', { maxNumericValue: 300, aggregationMethod: 'median-run' }],
        'first-contentful-paint': [
          'error',
          { maxNumericValue: 2000, aggregationMethod: 'median-run' },
        ],
        'server-response-time': [
          'error',
          { maxNumericValue: 800, aggregationMethod: 'median-run' },
        ],
        // Weight budgets (bytes, transferred)
        'resource-summary:script:size': ['error', { maxNumericValue: 350_000 }],
        'resource-summary:stylesheet:size': ['error', { maxNumericValue: 60_000 }],
        'resource-summary:font:size': ['error', { maxNumericValue: 150_000 }],
        'resource-summary:image:size': ['error', { maxNumericValue: 400_000 }],
        'resource-summary:total:size': ['error', { maxNumericValue: 900_000 }],
        'resource-summary:third-party:count': ['error', { maxNumericValue: 0 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
}
