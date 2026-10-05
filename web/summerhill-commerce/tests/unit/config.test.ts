import { describe, expect, it } from 'vitest'

import { ConfigError, parseConfig } from '@/server/config'

const valid = {
  DATABASE_URL: 'postgres://app:pw@127.0.0.1:5433/payload',
  PAYLOAD_SECRET: 'x'.repeat(32),
  NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
  STRIPE_SECRET_KEY: 'sk_test_abc',
}

describe('parseConfig', () => {
  it('accepts a valid environment and fills defaults', () => {
    const c = parseConfig(valid)
    expect(c.catalogDatabaseUrl).toBe(valid.DATABASE_URL)
    expect(c.ELASTICSEARCH_URL).toBe('http://localhost:9200')
    expect(c.DEFAULT_MERCHANT_ID).toBe(1)
    expect(c.stripeMode).toBe('test')
    expect(c.isProduction).toBe(false)
  })

  it('uses CATALOG_DATABASE_URL when set', () => {
    const c = parseConfig({
      ...valid,
      CATALOG_DATABASE_URL: 'postgres://app:pw@127.0.0.1:5433/grocery',
    })
    expect(c.catalogDatabaseUrl).toBe('postgres://app:pw@127.0.0.1:5433/grocery')
  })

  it('refuses live Stripe keys', () => {
    expect(() => parseConfig({ ...valid, STRIPE_SECRET_KEY: 'sk_live_abc' })).toThrow(/TEST key/)
  })

  it('treats empty strings as missing and reports every problem at once', () => {
    let message = ''
    try {
      parseConfig({ ...valid, PAYLOAD_SECRET: '', DATABASE_URL: 'mysql://x' })
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      message = (err as Error).message
    }
    expect(message).toMatch(/PAYLOAD_SECRET/)
    expect(message).toMatch(/DATABASE_URL/)
  })

  it('rejects an invalid server URL', () => {
    expect(() => parseConfig({ ...valid, NEXT_PUBLIC_SERVER_URL: 'not a url' })).toThrow(
      ConfigError,
    )
  })

  it('refuses the payment simulator in production unless explicitly allowed (G4-18)', () => {
    const sim = { ...valid, NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulator' }
    expect(() => parseConfig(sim)).toThrow(/simulator is not allowed in production/)
    expect(parseConfig({ ...sim, ALLOW_PAYMENT_SIMULATOR: 'true' }).PAYMENT_PROVIDER).toBe(
      'simulator',
    )
    expect(parseConfig({ ...valid, PAYMENT_PROVIDER: 'simulator' }).PAYMENT_PROVIDER).toBe(
      'simulator',
    )
    expect(parseConfig(valid).PAYMENT_PROVIDER).toBe('stripe')
  })
})
