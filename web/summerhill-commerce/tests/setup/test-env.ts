// Deterministic, harmless environment for unit/authz/integration tests. Deliberately does NOT
// load .env: tests must never pick up real keys or point at a developer's real database.
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/payload_test_unused',
  PAYLOAD_SECRET: 'test-secret-not-used-anywhere-real',
  NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
  STRIPE_SECRET_KEY: 'sk_test_unit',
  ELASTICSEARCH_URL: 'http://127.0.0.1:1',
  LOG_LEVEL: 'silent',
}
for (const [key, value] of Object.entries(testEnv)) process.env[key] = value
delete process.env.CATALOG_DATABASE_URL
