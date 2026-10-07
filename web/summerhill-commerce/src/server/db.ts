import { Pool, type PoolClient } from 'pg'

import { getConfig } from './config'
import { getLogger } from './logger'

/**
 * The single Postgres pool for the marketplace modules (G1-05). Replaces src/lib/catalogDb.ts,
 * which had hard-coded credentials.
 *
 * search_path covers the module schemas so existing unqualified queries work both against the
 * migrated database (tables in catalog/merchant schemas) and against an older local database
 * (tables in public). New code should schema-qualify table names.
 */
let pool: Pool | undefined

export function getDb(): Pool {
  if (!pool) {
    const config = getConfig()
    pool = new Pool({
      connectionString: config.catalogDatabaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
      options:
        '-c search_path=catalog,merchant,commerce,finance,ops,public -c statement_timeout=10000',
    })
    // An idle connection the server drops (restart, failover, a forced DROP DATABASE in tests)
    // is emitted as an 'error' on the pool; with no listener Node treats it as an uncaught
    // exception and the process dies. The pool discards the client and opens a new one on demand.
    pool.on('error', (err) => {
      getLogger().warn(
        { err: err.message },
        'idle postgres connection lost; the pool will reconnect',
      )
    })
  }
  return pool
}

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = Pick<Pool | PoolClient, 'query'>

/**
 * Runs `fn` in one transaction (BEGIN … COMMIT, ROLLBACK on error). State changes and their outbox
 * rows go through here so they commit together (ADR-0008).
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Closes the pool (tests and graceful shutdown). The next getDb() opens a new one. */
export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}
