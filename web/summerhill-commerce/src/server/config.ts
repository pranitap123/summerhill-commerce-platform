import { z } from 'zod'

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: postgresUrl,

  CATALOG_DATABASE_URL: postgresUrl.optional(),
  PAYLOAD_SECRET: z.string().min(1, 'is required'),

  NEXT_PUBLIC_SERVER_URL: z.url(),

  STRIPE_SECRET_KEY: z
    .string()
    .regex(
      /^(sk|rk)_test_/,
      'must be a Stripe TEST key (sk_test_… or rk_test_…); live keys are not allowed',
    ),

  STRIPE_WEBHOOKS_SIGNING_SECRET: z.string().startsWith('whsec_').optional(),
  STRIPE_CONNECT_WEBHOOKS_SIGNING_SECRET: z.string().startsWith('whsec_').optional(),

  STRIPE_CARD_FEATURES: z.enum(['off', 'if_available']).default('off'),

  PAYMENT_PROVIDER: z.enum(['stripe', 'simulator']).default('stripe'),

  CONNECT_ACCOUNT_TYPE: z.enum(['custom', 'express']).default('custom'),

  ALLOW_PAYMENT_SIMULATOR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('Grocery Marketplace Demo <orders@example.com>'),

  ALERT_EMAIL_PAGE: z.email().default('oncall@example.com'),
  ALERT_EMAIL_OPS: z.email().default('ops@example.com'),
  ALERT_EMAIL_FINANCE: z.email().default('finance@example.com'),

  WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),

  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),

  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),

  SEARCH_INDEX_ALIAS: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{2,60}$/, 'lowercase letters, digits, - and _ only')
    .default('catalog-products'),

  DEFAULT_MERCHANT_ID: z.coerce.number().int().positive().default(1),

  SUPPORT_AUTO_REFUND_MAX_CENTS: z.coerce.number().int().min(0).default(1_500),
  SUPPORT_AUTO_REFUND_90D_MAX_CENTS: z.coerce.number().int().min(0).default(3_000),

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

export function resetConfigForTests(): void {
  cached = undefined
}
