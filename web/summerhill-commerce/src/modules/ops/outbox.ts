import type { Db } from '@/server/db'
import { withTransaction } from '@/server/db'
import { currentTraceCarrier, type TraceCarrier } from '@/server/tracing'

import { enqueue } from './jobs'

/**
 * Transactional outbox (G2-03, SYSTEM_DESIGN §6.1). `emit` is called inside the same transaction
 * as the state change; `relayOutbox` later turns each event into one job per subscribed consumer
 * queue and marks it published, in a single transaction. Because the jobs live in the same
 * database, publication is exactly-once: an event is never published twice or lost.
 */
export async function emit(
  db: Db,
  topic: string,
  key: string | number,
  payload: Record<string, unknown> = {},
): Promise<string> {
  // G6-08: the emitting request's trace continues in the consumers' jobs
  const trace = currentTraceCarrier()
  const { rows } = await db.query<{ event_id: string }>(
    'INSERT INTO ops.outbox (topic, key, payload) VALUES ($1, $2, $3) RETURNING event_id',
    [topic, String(key), trace ? { ...payload, _trace: trace } : payload],
  )
  return rows[0].event_id
}

export interface OutboxEvent {
  eventId: string
  topic: string
  key: string
  payload: Record<string, unknown>
}

/** topic pattern → consumer queues. A pattern ending in `*` matches by prefix. */
export type Subscriptions = Record<string, string[]>

export function queuesFor(topic: string, subscriptions: Subscriptions): string[] {
  const queues = new Set<string>()
  for (const [pattern, consumers] of Object.entries(subscriptions)) {
    const match = pattern.endsWith('*') ? topic.startsWith(pattern.slice(0, -1)) : topic === pattern
    if (match) consumers.forEach((q) => queues.add(q))
  }
  return [...queues]
}

/** Publishes up to `limit` pending events. Returns how many were published. */
export async function relayOutbox(subscriptions: Subscriptions, limit = 100): Promise<number> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string
      event_id: string
      topic: string
      key: string
      payload: Record<string, unknown>
    }>(
      `SELECT id, event_id, topic, key, payload FROM ops.outbox
       WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    )
    for (const row of rows) {
      const { _trace, ...payload } = row.payload as { _trace?: TraceCarrier }
      const event: OutboxEvent = {
        eventId: row.event_id,
        topic: row.topic,
        key: row.key,
        payload,
      }
      for (const queue of queuesFor(row.topic, subscriptions))
        await enqueue(tx, queue, _trace ? { event, trace: _trace } : { event }, {
          dedupeKey: row.event_id,
        })
    }
    if (rows.length)
      await tx.query('UPDATE ops.outbox SET published_at = now() WHERE id = ANY($1::bigint[])', [
        rows.map((r) => r.id),
      ])
    return rows.length
  })
}

/**
 * Consumer-side guard: runs `fn` at most once per (consumer, event), inside a transaction that also
 * records the event as processed. Returns false when the event was already handled.
 */
export async function handleOnce(
  consumer: string,
  eventId: string,
  fn: (tx: Db) => Promise<void>,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `INSERT INTO ops.processed_events (consumer, event_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [consumer, eventId],
    )
    if (!rowCount) return false
    await fn(tx)
    return true
  })
}
