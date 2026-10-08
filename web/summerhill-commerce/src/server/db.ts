import { Pool, type PoolClient } from 'pg'

import { getConfig } from './config'
import { getLogger } from './logger'

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

    pool.on('error', (err) => {
      getLogger().warn(
        { err: err.message },
        'idle postgres connection lost; the pool will reconnect',
      )
    })
  }
  return pool
}

export type Db = Pick<Pool | PoolClient, 'query'>

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

export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}
