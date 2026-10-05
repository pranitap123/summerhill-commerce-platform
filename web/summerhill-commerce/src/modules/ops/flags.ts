import type { Db } from '@/server/db'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { audit, type AuditContext } from './audit'

/**
 * DB-backed feature flags / kill switches (SYSTEM_DESIGN §11), cached for 30 s so a switch takes
 * effect everywhere within half a minute without a deploy. Unknown flags are off.
 */
const TTL_MS = 30_000
let cache: { at: number; flags: Map<string, boolean> } | undefined

export async function isEnabled(key: string, db: Db = getDb()): Promise<boolean> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const { rows } = await db.query<{ key: string; enabled: boolean }>(
      'SELECT key, enabled FROM ops.feature_flags',
    )
    cache = { at: Date.now(), flags: new Map(rows.map((r) => [r.key, r.enabled])) }
  }
  return cache.flags.get(key) ?? false
}

export function clearFlagCache(): void {
  cache = undefined
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  description: string
  updatedBy: string | null
  updatedAt: Date
}

export async function listFlags(db: Db = getDb()): Promise<FeatureFlag[]> {
  const { rows } = await db.query(
    'SELECT key, enabled, description, updated_by, updated_at FROM ops.feature_flags ORDER BY key',
  )
  return rows.map((r) => ({
    key: r.key,
    enabled: r.enabled,
    description: r.description,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }))
}

/** Uncached read (the storefront banner polls this, so a kill switch shows within seconds). */
export async function readFlagNow(key: string, db: Db = getDb()): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    'SELECT enabled FROM ops.feature_flags WHERE key = $1',
    [key],
  )
  return rows[0]?.enabled ?? false
}

/** Flips a flag (G5-10, A13); audited with before/after. Other processes see it within 30 s. */
export async function setFlag(
  ctx: AuditContext,
  key: string,
  enabled: boolean,
): Promise<FeatureFlag> {
  const flag = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE ops.feature_flags f SET enabled = $2, updated_by = $3, updated_at = now()
       FROM (SELECT enabled AS before FROM ops.feature_flags WHERE key = $1 FOR UPDATE) b
       WHERE f.key = $1 RETURNING f.key, f.enabled, f.description, f.updated_by, f.updated_at, b.before`,
      [key, enabled, ctx.actor.id],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Unknown flag')
    await audit(tx, {
      ...ctx,
      action: 'flag.set',
      targetType: 'flag',
      targetId: key,
      data: { before: rows[0].before, after: enabled },
    })
    return rows[0]
  })
  clearFlagCache()
  return {
    key: flag.key,
    enabled: flag.enabled,
    description: flag.description,
    updatedBy: flag.updated_by,
    updatedAt: flag.updated_at,
  }
}
