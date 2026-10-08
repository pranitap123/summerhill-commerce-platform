import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

export type ActorType = 'customer' | 'merchant_staff' | 'admin' | 'system' | 'stripe'

export interface Actor {
  type: ActorType
  id: string | null
}

export interface AuditContext {
  actor: Actor
  requestId?: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface AuditEntry extends AuditContext {
  action: string
  targetType: string
  targetId: string | number | null

  data?: Record<string, unknown>
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO ops.audit_log
       (actor_type, actor_id, action, target_type, target_id, data, request_id, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.actor.type,
      entry.actor.id,
      entry.action,
      entry.targetType,
      entry.targetId === null ? null : String(entry.targetId),
      entry.data ?? {},
      entry.requestId ?? null,
      entry.ip ?? null,
      entry.userAgent?.slice(0, 300) ?? null,
    ],
  )
}

export interface AuditRow {
  id: number
  actorType: ActorType
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  data: Record<string, unknown>
  requestId: string | null
  ip: string | null
  userAgent: string | null
  at: Date
}

export async function searchAuditLog(
  filter: {
    actorId?: string
    action?: string
    targetType?: string
    targetId?: string
    before?: number
    limit?: number
  },
  db: Db = getDb(),
): Promise<AuditRow[]> {
  const { rows } = await db.query(
    `SELECT id, actor_type, actor_id, action, target_type, target_id, data, request_id, ip,
       user_agent, at
     FROM ops.audit_log
     WHERE ($1::text IS NULL OR actor_id = $1)
       AND ($2::text IS NULL OR action LIKE $2 || '%')
       AND ($3::text IS NULL OR target_type = $3)
       AND ($4::text IS NULL OR target_id = $4)
       AND ($5::bigint IS NULL OR id < $5)
     ORDER BY id DESC LIMIT $6`,
    [
      filter.actorId ?? null,
      filter.action ?? null,
      filter.targetType ?? null,
      filter.targetId ?? null,
      filter.before ?? null,
      Math.min(filter.limit ?? 100, 500),
    ],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    actorType: r.actor_type,
    actorId: r.actor_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    data: r.data,
    requestId: r.request_id,
    ip: r.ip,
    userAgent: r.user_agent,
    at: r.at,
  }))
}
