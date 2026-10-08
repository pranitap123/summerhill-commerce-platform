import { execFileSync } from 'node:child_process'
import path from 'node:path'

import pg from 'pg'

export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://grocery_admin:local_dev_only@127.0.0.1:5433/grocery'
const ROLE_PASSWORD = process.env.TEST_ROLE_PASSWORD ?? 'local_dev_only'
export const REPO_ROOT = path.resolve(__dirname, '../../../..')

export function withDb(url: string, db: string, user?: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  if (user) {
    u.username = user
    u.password = ROLE_PASSWORD
  }
  return u.toString()
}

export async function sql(url: string, text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

export const runScript = (script: string, env: Record<string, string>, arg?: string) =>
  execFileSync(process.execPath, [path.join(REPO_ROOT, script), ...(arg ? [arg] : [])], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

export interface TestDb {
  name: string
  adminUrl: string
  asRole(role: string): string
  drop(): Promise<void>
}

export async function createTestDb(prefix: string): Promise<TestDb> {
  const name = `${prefix}_${process.pid}_${Date.now()}`
  await sql(ADMIN_URL, `CREATE DATABASE ${name}`)
  await sql(ADMIN_URL, `GRANT CONNECT ON DATABASE ${name} TO app_rw, ingest_rw, readonly`)
  const adminUrl = withDb(ADMIN_URL, name)
  runScript('db/migrate.mjs', { MIGRATION_DATABASE_URL: adminUrl })

  runScript('db/seed/seed.mjs', {
    SEED_DATABASE_URL: adminUrl,
    INGEST_DATABASE_URL: withDb(ADMIN_URL, name, 'ingest_rw'),
  })

  await sql(adminUrl, 'UPDATE ops.outbox SET published_at = now() WHERE published_at IS NULL')
  return {
    name,
    adminUrl,
    asRole: (role) => withDb(ADMIN_URL, name, role),
    drop: async () => {
      await sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    },
  }
}
