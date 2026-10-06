import { z } from 'zod'

/**
 * Validated server configuration (G1-02). Every server-side setting is read here and nowhere else.
 * `getConfig()` throws a readable error listing every problem, and `src/instrumentation.ts` calls
 * it at boot, so the app refuses to start with a missing or invalid variable.
 *
 * Client components keep reading NEXT_PUBLIC_* directly (Next.js inlines them at build time).
 */
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Payload CMS database (users, pages, media). Kept separate from the marketplace database
  // because Payload's schemaName option is experimental (see ADR-0004).
  DATABASE_URL: postgresUrl,
  // Marketplace database (schemas catalog, merchant, commerce, finance, ops). Defaults to
  // DATABASE_URL for older single-database local setups.
  CATALOG_DATABASE_URL: postgresUrl.optional(),
  PAYLOAD_SECRET: z.string().min(1, 'is required'),

  NEXT_PUBLIC_SERVER_URL: z.url(),

  // This project runs in Stripe test mode only: live keys are rejected on purpose.
  STRIPE_SECRET_KEY: z
    .string()
    .regex(
      /^(sk|rk)_test_/,
      'must be a Stripe TEST key (sk_test_… or rk_test_…); live keys are not allowed',
    ),
  // Webhook signing secrets (G2-08). `stripe listen` prints one secret that signs both platform and
  // Connect events, so the Connect secret defaults to the platform one.
  STRIPE_WEBHOOKS_SIGNING_SECRET: z.string().startsWith('whsec_').optional(),
  STRIPE_CONNECT_WEBHOOKS_SIGNING_SECRET: z.string().startsWith('whsec_').optional(),
  // Card-network features (overcapture, incremental authorisation; PAYMENTS §3) need IC+ pricing
  // or Stripe's approval (decision B14). Stripe rejects the whole Checkout Session when an
  // ineligible account requests them, even with `if_available`, so they're opt-in.
  STRIPE_CARD_FEATURES: z.enum(['off', 'if_available']).default('off'),
  // Who processes payments: Stripe (test mode), or the in-app payment simulator (G4-18) for the
  // end-to-end tests and demos without a Stripe account. The simulator is refused in production.
  PAYMENT_PROVIDER: z.enum(['stripe', 'simulator']).default('stripe'),
  // Type of connected account created for a new merchant (ADR-0012). `custom` follows the project
  // brief: the platform owns onboarding (test-mode company data, terms acceptance with the
  // admin's IP). `express` uses Stripe-hosted onboarding (ADR-0011) and stays supported.
  CONNECT_ACCOUNT_TYPE: z.enum(['custom', 'express']).default('custom'),
  // A production *build* running the simulator: only the end-to-end tests' local build sets this
  // (simulator-build.env). Without it, PAYMENT_PROVIDER=simulator is refused when NODE_ENV=production.
  ALLOW_PAYMENT_SIMULATOR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Transactional email (G2-14). Locally this is Mailpit from the compose stack.
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('Grocery Marketplace Demo <orders@example.com>'),

  // Where operational alerts are emailed, by channel (G6-09, OPERATIONS §3): paging (SEV1 and
  // payment failures), store operations, finance. Locally they all land in Mailpit.
  ALERT_EMAIL_PAGE: z.email().default('oncall@example.com'),
  ALERT_EMAIL_OPS: z.email().default('ops@example.com'),
  ALERT_EMAIL_FINANCE: z.email().default('finance@example.com'),

  // Worker (G2-03): how often an idle worker polls for jobs and outbox events.
  WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),

  // Postgres connect timeout. 5 s in production; raise it in dev on slow machines, where in-process
  // compilation can delay the connection handshake.
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),

  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),
  // Search v2 (G3-08): the alias queries go through; each rebuild creates `<alias>-<timestamp>` and
  // swaps the alias atomically. Tests use their own alias.
  SEARCH_INDEX_ALIAS: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{2,60}$/, 'lowercase letters, digits, - and _ only')
    .default('catalog-products'),

  // Merchant used by the separate-charge demo route (checkout v2 takes the merchant from the cart).
  DEFAULT_MERCHANT_ID: z.coerce.number().int().positive().default(1),

  // Support auto-approval thresholds (G5-11, ORDERS §10): per issue, and per customer over 90 days
  SUPPORT_AUTO_REFUND_MAX_CENTS: z.coerce.number().int().min(0).default(1_500),
  SUPPORT_AUTO_REFUND_90D_MAX_CENTS: z.coerce.number().int().min(0).default(3_000),

  // Proxies in front of the app that append to X-Forwarded-For (G6-01): the client address is that
  // many entries from the right; anything further left is client-supplied. 1 = one load balancer.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = z.infer<typeof schema> & {
  catalogDatabaseUrl: string
  stripeMode: 'test'
  isProduction: boolean
}

let cached: Config | undefined

export class ConfigError extends Error {}

export function parseConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as "not set" so `KEY=` in a .env file doesn't satisfy a required value.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  )
  const result = schema.safeParse(cleaned)
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    )
    throw new ConfigError(
      `Invalid configuration:\n${problems.join('\n')}\nSee .env.example for every variable.`,
    )
  }
  const c = result.data
  if (
    c.NODE_ENV === 'production' &&
    c.PAYMENT_PROVIDER === 'simulator' &&
    !c.ALLOW_PAYMENT_SIMULATOR
  )
    throw new ConfigError(
      'Invalid configuration:\n  - PAYMENT_PROVIDER: the payment simulator is not allowed in production',
    )
  // Session cookies are Secure in production (G6-01), which needs HTTPS; localhost is exempt
  // because browsers treat it as a secure context (the end-to-end tests run a production build).
  const server = new URL(c.NEXT_PUBLIC_SERVER_URL)
  if (
    c.NODE_ENV === 'production' &&
    server.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)
  )
    throw new ConfigError(
      'Invalid configuration:\n  - NEXT_PUBLIC_SERVER_URL: must use https:// in production',
    )
  return {
    ...c,
    catalogDatabaseUrl: c.CATALOG_DATABASE_URL ?? c.DATABASE_URL,
    stripeMode: 'test',
    isProduction: c.NODE_ENV === 'production',
  }
}

export function getConfig(): Config {
  if (typeof window !== 'undefined') throw new Error('server config imported in the browser')
  cached ??= parseConfig(process.env)
  return cached
}

/** Test helper: forget the cached config after changing process.env. */
export function resetConfigForTests(): void {
  cached = undefined
}
