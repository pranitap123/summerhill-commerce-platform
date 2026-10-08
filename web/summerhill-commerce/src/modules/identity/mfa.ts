import { consume, LIMITS } from '@/modules/ops'
import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'
import { decrypt, decryptWithSecret, encrypt, sign, unsign } from '@/server/signing'

import { generateTotpSecret, otpauthUri, verifyTotp } from './totp'

export const MFA_COOKIE = 'mfa'
export const MFA_SESSION_MS = 8 * 3600_000
export const MFA_ISSUER = 'Grocery Marketplace Demo'

export interface MfaStatus {
  enrolled: boolean
  confirmed: boolean
}

export async function getMfaStatus(userId: string, db: Db = getDb()): Promise<MfaStatus> {
  const { rows } = await db.query<{ confirmed: boolean }>(
    'SELECT confirmed_at IS NOT NULL AS confirmed FROM ops.staff_mfa WHERE user_id = $1',
    [userId],
  )
  return { enrolled: !!rows[0], confirmed: rows[0]?.confirmed ?? false }
}

export async function beginEnrolment(
  userId: string,
  email: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret()
  const { rowCount } = await getDb().query(
    `INSERT INTO ops.staff_mfa (user_id, secret_encrypted) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
       last_step = NULL, failures = 0
     WHERE ops.staff_mfa.confirmed_at IS NULL`,
    [userId, encrypt('mfa-secret', secret)],
  )
  if (!rowCount)
    throw new HttpError(
      409,
      'MFA_ALREADY_ENROLLED',
      'Two-step verification is already set up. Ask an admin to reset it if you lost the device.',
    )
  return { secret, otpauthUri: otpauthUri(secret, email, MFA_ISSUER) }
}

export async function verifyMfaCode(
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<void> {
  await consume(LIMITS.mfa, `user:${userId}`)
  const outcome = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ secret_encrypted: string; last_step: string | null }>(
      'SELECT secret_encrypted, last_step FROM ops.staff_mfa WHERE user_id = $1 FOR UPDATE',
      [userId],
    )
    if (!rows[0]) throw new HttpError(409, 'MFA_NOT_ENROLLED', 'Set up two-step verification first')
    const secret = decrypt('mfa-secret', rows[0].secret_encrypted)
    const lastStep = rows[0].last_step === null ? null : Number(rows[0].last_step)
    const step = verifyTotp(secret, code.trim(), now, lastStep)
    if (step === null) {
      await tx.query('UPDATE ops.staff_mfa SET failures = failures + 1 WHERE user_id = $1', [
        userId,
      ])
      return 'invalid'
    }
    await tx.query(
      `UPDATE ops.staff_mfa SET last_step = $2, failures = 0,
         confirmed_at = COALESCE(confirmed_at, now()) WHERE user_id = $1`,
      [userId, step],
    )
    return 'ok'
  })
  if (outcome === 'invalid')
    throw new HttpError(400, 'MFA_CODE_INVALID', 'That code is not valid. Try the current one.')
}

export async function resetMfa(userId: string, db: Db = getDb()): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM ops.staff_mfa WHERE user_id = $1', [userId])
  return !!rowCount
}

export async function reencryptMfaSecrets(
  previousSecret: string,
  db: Db = getDb(),
): Promise<{ reencrypted: number; current: number; unreadable: string[] }> {
  const { rows } = await db.query<{ user_id: string; secret_encrypted: string }>(
    'SELECT user_id, secret_encrypted FROM ops.staff_mfa ORDER BY user_id',
  )
  const result = { reencrypted: 0, current: 0, unreadable: [] as string[] }
  for (const row of rows) {
    if (canOpen(() => decrypt('mfa-secret', row.secret_encrypted))) {
      result.current++
      continue
    }
    let secret: string
    try {
      secret = decryptWithSecret(previousSecret, 'mfa-secret', row.secret_encrypted)
    } catch {
      result.unreadable.push(row.user_id)
      continue
    }
    await db.query('UPDATE ops.staff_mfa SET secret_encrypted = $2 WHERE user_id = $1', [
      row.user_id,
      encrypt('mfa-secret', secret),
    ])
    result.reencrypted++
  }
  return result
}

function canOpen(read: () => string): boolean {
  try {
    read()
    return true
  } catch {
    return false
  }
}

export async function enrolWithSecret(db: Db, userId: string, secret: string): Promise<void> {
  await db.query(
    `INSERT INTO ops.staff_mfa (user_id, secret_encrypted, confirmed_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
       confirmed_at = now(), last_step = NULL, failures = 0`,
    [userId, encrypt('mfa-secret', secret)],
  )
}

export function mfaCookieValue(
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): { value: string; maxAgeSeconds: number } {
  const expires = now.getTime() + MFA_SESSION_MS
  return {
    value: sign('mfa-session', `${userId}~${sessionId}~${expires}`),
    maxAgeSeconds: MFA_SESSION_MS / 1000,
  }
}

export function isMfaCookieValid(
  cookie: string | null | undefined,
  userId: string,
  sessionId: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sessionId) return false
  const value = unsign('mfa-session', cookie)
  if (!value) return false
  const [uid, sid, expires] = value.split('~')
  return uid === userId && sid === sessionId && Number(expires) > now.getTime()
}

export function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
