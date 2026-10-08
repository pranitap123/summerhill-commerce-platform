import { createHash } from 'node:crypto'

import type { Db } from '@/server/db'
import { getDb } from '@/server/db'
import { HttpError } from '@/server/http'

const KEY = /^[A-Za-z0-9._:-]{8,255}$/

export function readIdempotencyKey(headers: Headers): string {
  const key = headers.get('idempotency-key')
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required')
  if (!KEY.test(key))
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key must be 8–255 letters, digits or . _ : -',
    )
  return key
}

export function requestHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export interface StoredResponse {
  status: number
  body: unknown
  replayed: boolean
}

export async function withIdempotency(
  scope: string,
  key: string,
  hash: string,
  run: () => Promise<{ status: number; body: unknown }>,
  db: Db = getDb(),
): Promise<StoredResponse> {
  const inserted = await db.query(
    `INSERT INTO ops.idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (scope, key) DO NOTHING`,
    [scope, key, hash],
  )
  if (!inserted.rowCount) {
    const { rows } = await db.query<{
      request_hash: string
      status: string
      response_status: number | null
      response_body: unknown
      expired: boolean
    }>(
      `SELECT request_hash, status, response_status, response_body,
         expires_at < now() OR (status = 'in_progress' AND created_at < now() - interval '2 minutes') AS expired
       FROM ops.idempotency_keys WHERE scope = $1 AND key = $2`,
      [scope, key],
    )
    const row = rows[0]
    if (!row || row.expired) {
      await db.query('DELETE FROM ops.idempotency_keys WHERE scope = $1 AND key = $2', [scope, key])
      return withIdempotency(scope, key, hash, run, db)
    }
    if (row.request_hash !== hash)
      throw new HttpError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request',
      )
    if (row.status !== 'completed')
      throw new HttpError(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this Idempotency-Key is still being processed',
      )
    return { status: row.response_status!, body: row.response_body, replayed: true }
  }

  let result: { status: number; body: unknown }
  try {
    result = await run()
  } catch (err) {
    if (err instanceof HttpError && err.status < 500 && err.status !== 429) {
      const body = { error: { code: err.code, message: err.message, details: err.details } }
      await store(db, scope, key, err.status, body)
    } else {
      await db.query('DELETE FROM ops.idempotency_keys WHERE scope = $1 AND key = $2', [scope, key])
    }
    throw err
  }
  await store(db, scope, key, result.status, result.body)
  return { ...result, replayed: false }
}

async function store(db: Db, scope: string, key: string, status: number, body: unknown) {
  await db.query(
    `UPDATE ops.idempotency_keys SET status = 'completed', response_status = $3, response_body = $4
     WHERE scope = $1 AND key = $2`,
    [scope, key, status, JSON.stringify(body)],
  )
}

export async function purgeExpiredIdempotencyKeys(db: Db = getDb()): Promise<void> {
  await db.query('DELETE FROM ops.idempotency_keys WHERE expires_at < now()')
}
