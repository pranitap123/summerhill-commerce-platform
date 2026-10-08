import { randomUUID } from 'node:crypto'

import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

export interface Job<P = Record<string, unknown>> {
  id: number
  queue: string
  payload: P
  attempts: number
  maxAttempts: number
  dedupeKey: string | null
}

export interface EnqueueOptions {
  dedupeKey?: string
  runAt?: Date
  maxAttempts?: number
}

export async function enqueue(
  db: Db,
  queue: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<number | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ops.jobs (queue, payload, dedupe_key, run_at, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5)
     ON CONFLICT (queue, dedupe_key) DO NOTHING
     RETURNING id`,
    [queue, payload, opts.dedupeKey ?? null, opts.runAt ?? null, opts.maxAttempts ?? 5],
  )
  return rows[0] ? Number(rows[0].id) : null
}

interface JobRow {
  id: string
  queue: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  dedupe_key: string | null
}

export async function claimJobs(queues: string[], limit: number, workerId: string): Promise<Job[]> {
  if (queues.length === 0) return []
  const { rows } = await getDb().query<JobRow>(
    `UPDATE ops.jobs SET status = 'running', locked_at = now(), locked_by = $3, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM ops.jobs
       WHERE status = 'queued' AND queue = ANY($1::text[]) AND run_at <= now()
       ORDER BY run_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $2)
     RETURNING id, queue, payload, attempts, max_attempts, dedupe_key`,
    [queues, limit, workerId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    queue: r.queue,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    dedupeKey: r.dedupe_key,
  }))
}

export async function completeJob(id: number): Promise<void> {
  await getDb().query(
    `UPDATE ops.jobs SET status = 'completed', completed_at = now(), locked_at = NULL, last_error = NULL
     WHERE id = $1`,
    [id],
  )
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(2 ** attempt * 1000, 15 * 60_000)
  return Math.round(base * (0.75 + random() * 0.5))
}

export async function failJob(job: Job, error: unknown): Promise<'retry' | 'dead'> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
  if (job.attempts >= job.maxAttempts) {
    await getDb().query(
      `UPDATE ops.jobs SET status = 'dead', locked_at = NULL, last_error = $2 WHERE id = $1`,
      [job.id, message],
    )
    return 'dead'
  }
  await getDb().query(
    `UPDATE ops.jobs SET status = 'queued', locked_at = NULL, last_error = $2,
       run_at = now() + ($3::int * interval '1 millisecond')
     WHERE id = $1`,
    [job.id, message, backoffMs(job.attempts)],
  )
  return 'retry'
}

export async function recoverStuckJobs(olderThanMs = 5 * 60_000): Promise<number> {
  const { rowCount } = await getDb().query(
    `UPDATE ops.jobs SET status = 'queued', locked_at = NULL, last_error = 'recovered after worker timeout'
     WHERE status = 'running' AND locked_at < now() - ($1::int * interval '1 millisecond')`,
    [olderThanMs],
  )
  return rowCount ?? 0
}

export const newWorkerId = () => `worker-${process.pid}-${randomUUID().slice(0, 8)}`
