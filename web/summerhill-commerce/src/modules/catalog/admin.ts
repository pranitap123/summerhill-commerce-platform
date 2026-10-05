import { audit, type AuditContext } from '@/modules/ops'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Catalogue admin (G5-14, A3/A4): ingest runs with counts and errors, held-run decisions, re-runs
 * and the category-mapping editor. The app can't write catalog.products (ADR-0004): approving a
 * held run or asking for a run inserts an ops.ingest_requests row that the pipeline carries out
 * (Dagster sensor, or `npm run pipeline:requests`). Rejecting only changes the run's status, so
 * the app does it directly, like the pipeline's own `reject`.
 */
export interface IngestRun {
  id: number
  merchantId: number
  merchant: string
  connector: string
  mode: 'full' | 'delta'
  status: string
  fetched: number
  inserted: number
  updated: number
  unchanged: number
  deactivated: number
  quarantined: number
  anomalies: Array<Record<string, unknown>>
  flags: number
  error: string | null
  approvedBy: string | null
  startedAt: Date
  durationMs: number | null
  pendingRequest: { id: number; kind: string } | null
}

function toRun(r: Record<string, unknown>): IngestRun {
  return {
    id: Number(r.id),
    merchantId: Number(r.merchant_id),
    merchant: String(r.merchant),
    connector: String(r.connector),
    mode: r.mode as IngestRun['mode'],
    status: String(r.status),
    fetched: Number(r.fetched),
    inserted: Number(r.inserted),
    updated: Number(r.updated),
    unchanged: Number(r.unchanged),
    deactivated: Number(r.deactivated),
    quarantined: Number(r.quarantined),
    anomalies: (r.anomalies as IngestRun['anomalies']) ?? [],
    flags: Number(r.flags),
    error: (r.error as string) ?? null,
    approvedBy: (r.approved_by as string) ?? null,
    startedAt: r.started_at as Date,
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    pendingRequest: r.request_id
      ? { id: Number(r.request_id), kind: String(r.request_kind) }
      : null,
  }
}

const RUN_SELECT = `SELECT r.id, r.merchant_id, m.slug AS merchant, r.connector, r.mode, r.status, r.fetched,
    r.inserted, r.updated, r.unchanged, r.deactivated, r.quarantined, r.anomalies,
    jsonb_array_length(r.flags) AS flags, r.error, r.approved_by, r.started_at, r.duration_ms,
    q.id AS request_id, q.kind AS request_kind
  FROM ops.ingest_runs r JOIN merchant.merchants m ON m.id = r.merchant_id
  LEFT JOIN ops.ingest_requests q ON q.run_id = r.id AND q.status = 'pending'`

export async function listIngestRuns(limit = 20): Promise<IngestRun[]> {
  const { rows } = await getDb().query(`${RUN_SELECT} ORDER BY r.id DESC LIMIT $1`, [limit])
  return rows.map(toRun)
}

export async function getIngestRun(id: number) {
  const { rows } = await getDb().query(`${RUN_SELECT} WHERE r.id = $1`, [id])
  if (!rows[0]) return null
  const [quarantine, flags] = await Promise.all([
    getDb().query(
      `SELECT external_id, reason, created_at FROM ops.ingest_quarantine WHERE run_id = $1 ORDER BY id LIMIT 200`,
      [id],
    ),
    getDb().query<{ flags: unknown[] }>('SELECT flags FROM ops.ingest_runs WHERE id = $1', [id]),
  ])
  return { run: toRun(rows[0]), quarantine: quarantine.rows, flags: flags.rows[0]?.flags ?? [] }
}

export interface IngestRequest {
  id: number
  merchant: string
  kind: 'approve' | 'run'
  runId: number | null
  mode: string | null
  requestedBy: string
  status: 'pending' | 'done' | 'failed'
  error: string | null
  createdAt: Date
  processedAt: Date | null
}

export async function listIngestRequests(limit = 20): Promise<IngestRequest[]> {
  const { rows } = await getDb().query(
    `SELECT q.*, m.slug AS merchant FROM ops.ingest_requests q
     JOIN merchant.merchants m ON m.id = q.merchant_id ORDER BY q.id DESC LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    merchant: r.merchant,
    kind: r.kind,
    runId: r.run_id === null ? null : Number(r.run_id),
    mode: r.mode,
    requestedBy: r.requested_by,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    processedAt: r.processed_at,
  }))
}

/** Approve (→ pipeline request) or reject (directly) a held run. */
export async function decideHeldRun(
  ctx: AuditContext,
  runId: number,
  decision: 'approve' | 'reject',
): Promise<{ status: string; requestId: number | null }> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ status: string; merchant_id: string }>(
      'SELECT status, merchant_id FROM ops.ingest_runs WHERE id = $1 FOR UPDATE',
      [runId],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Ingest run not found')
    if (rows[0].status !== 'held')
      throw new HttpError(409, 'RUN_NOT_HELD', `Run ${runId} is ${rows[0].status}, not held`)
    const who = ctx.actor.id ?? 'admin'
    let requestId: number | null = null
    if (decision === 'reject') {
      await tx.query(
        `UPDATE ops.ingest_runs SET status = 'rejected', approved_by = $2, staged = NULL WHERE id = $1`,
        [runId, who],
      )
    } else {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO ops.ingest_requests (merchant_id, kind, run_id, requested_by)
         VALUES ($1, 'approve', $2, $3) ON CONFLICT (run_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
        [rows[0].merchant_id, runId, who],
      )
      if (!inserted.rows[0])
        throw new HttpError(409, 'ALREADY_REQUESTED', 'Approval already requested')
      requestId = Number(inserted.rows[0].id)
    }
    await audit(tx, {
      ...ctx,
      action: `catalog.run_${decision}`,
      targetType: 'ingest_run',
      targetId: runId,
      data: { requestId },
    })
    return { status: decision === 'reject' ? 'rejected' : 'approval_requested', requestId }
  })
}

export async function requestIngestRun(
  ctx: AuditContext,
  merchantId: number,
  mode: 'full' | 'delta',
): Promise<number> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO ops.ingest_requests (merchant_id, kind, mode, requested_by)
       SELECT id, 'run', $2, $3 FROM merchant.merchants WHERE id = $1 RETURNING id`,
      [merchantId, mode, ctx.actor.id ?? 'admin'],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Merchant not found')
    await audit(tx, {
      ...ctx,
      action: 'catalog.run_request',
      targetType: 'merchant',
      targetId: merchantId,
      data: { mode, requestId: Number(rows[0].id) },
    })
    return Number(rows[0].id)
  })
}

export interface CategoryMapping {
  id: number
  merchant: string
  sourceType: string
  sourceSubtype: string
  status: 'mapped' | 'unmapped'
  subcategoryId: number | null
  subcategory: string | null
  category: string | null
}

export async function listCategoryMappings(onlyUnmapped = false): Promise<CategoryMapping[]> {
  const { rows } = await getDb().query(
    `SELECT c.id, m.slug AS merchant, c.source_type, c.source_subtype, c.status, c.subcategory_id,
       s.name AS subcategory, k.name AS category
     FROM catalog.category_mappings c JOIN merchant.merchants m ON m.id = c.merchant_id
     LEFT JOIN catalog.subcategories s ON s.id = c.subcategory_id
     LEFT JOIN catalog.categories k ON k.id = s.category_id
     WHERE NOT $1 OR c.status = 'unmapped'
     ORDER BY c.status DESC, c.source_type, c.source_subtype LIMIT 500`,
    [onlyUnmapped],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    merchant: r.merchant,
    sourceType: r.source_type,
    sourceSubtype: r.source_subtype,
    status: r.status,
    subcategoryId: r.subcategory_id === null ? null : Number(r.subcategory_id),
    subcategory: r.subcategory,
    category: r.category,
  }))
}

export async function listSubcategories(): Promise<
  Array<{ id: number; name: string; category: string }>
> {
  const { rows } = await getDb().query(
    `SELECT s.id, s.name, c.name AS category FROM catalog.subcategories s
     JOIN catalog.categories c ON c.id = s.category_id ORDER BY c.name, s.name`,
  )
  return rows.map((r) => ({ id: Number(r.id), name: r.name, category: r.category }))
}

/**
 * Maps a source category to one of ours. Existing products move at the next ingest (the pipeline
 * reads the mapping), so a re-run is requested too.
 */
export async function setCategoryMapping(
  ctx: AuditContext,
  mappingId: number,
  subcategoryId: number,
): Promise<{ requestId: number }> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ merchant_id: string; subcategory_id: string | null }>(
      `SELECT merchant_id, subcategory_id FROM catalog.category_mappings WHERE id = $1 FOR UPDATE`,
      [mappingId],
    )
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Mapping not found')
    const sub = await tx.query('SELECT 1 FROM catalog.subcategories WHERE id = $1', [subcategoryId])
    if (!sub.rowCount) throw new HttpError(422, 'SUBCATEGORY_NOT_FOUND', 'Unknown subcategory')
    await tx.query(
      `UPDATE catalog.category_mappings SET subcategory_id = $2, status = 'mapped' WHERE id = $1`,
      [mappingId, subcategoryId],
    )
    const req = await tx.query<{ id: string }>(
      `INSERT INTO ops.ingest_requests (merchant_id, kind, mode, requested_by) VALUES ($1, 'run', 'full', $2)
       RETURNING id`,
      [rows[0].merchant_id, ctx.actor.id ?? 'admin'],
    )
    await audit(tx, {
      ...ctx,
      action: 'catalog.mapping',
      targetType: 'category_mapping',
      targetId: mappingId,
      data: {
        before: rows[0].subcategory_id,
        after: subcategoryId,
        requestId: Number(req.rows[0].id),
      },
    })
    return { requestId: Number(req.rows[0].id) }
  })
}
