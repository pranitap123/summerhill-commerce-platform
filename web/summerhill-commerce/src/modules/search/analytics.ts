import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import type { SearchEngine } from './types'

const PII = [/[^\s@]+@[^\s@]+\.[^\s@]+/, /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/]

export function normaliseQuery(q: string): string {
  const clean = q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100)
  return PII.some((re) => re.test(clean)) ? '[redacted]' : clean
}

export async function logSearch(
  entry: {
    query: string
    resultCount: number
    engine: SearchEngine
    filters: Record<string, unknown>
    tookMs: number
  },
  db: Db = getDb(),
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ops.search_queries (query, result_count, engine, filters, took_ms)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [normaliseQuery(entry.query), entry.resultCount, entry.engine, entry.filters, entry.tookMs],
  )
  return rows[0].id
}

export async function recordSearchClick(
  searchId: string,
  productId: string,
  position: number,
  db: Db = getDb(),
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO ops.search_clicks (search_id, product_id, position)
     SELECT id, $2, $3 FROM ops.search_queries
     WHERE id = $1 AND created_at > now() - interval '1 day'
     ON CONFLICT DO NOTHING`,
    [searchId, productId, position],
  )
  return (rowCount ?? 0) > 0
}

export interface SearchReport {
  from: string
  to: string
  searches: number
  zeroResultRate: number
  clickThroughRate: number
  meanClickPosition: number | null
  topQueries: Array<{ query: string; searches: number; avgResults: number; clicks: number }>
  zeroResultQueries: Array<{ query: string; searches: number; lastSeen: string }>
  clickPositions: Array<{ position: number; clicks: number }>
}

export async function searchReport(days = 7, db: Db = getDb()): Promise<SearchReport> {
  const window = [days]
  const [totals, top, zero, positions] = await Promise.all([
    db.query<{
      from: Date
      to: Date
      searches: number
      zero: number
      clicked: number
      mean: string | null
    }>(
      `SELECT now() - make_interval(days => $1) AS from, now() AS to,
         count(*)::int AS searches,
         count(*) FILTER (WHERE result_count = 0)::int AS zero,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ops.search_clicks c WHERE c.search_id = q.id))::int AS clicked,
         (SELECT avg(c.position) FROM ops.search_clicks c JOIN ops.search_queries q2 ON q2.id = c.search_id
          WHERE q2.created_at > now() - make_interval(days => $1)) AS mean
       FROM ops.search_queries q WHERE q.created_at > now() - make_interval(days => $1)`,
      window,
    ),
    db.query<{ query: string; searches: number; avg_results: string; clicks: number }>(
      `SELECT q.query, count(*)::int AS searches, avg(q.result_count) AS avg_results,
         (SELECT count(*) FROM ops.search_clicks c JOIN ops.search_queries q2 ON q2.id = c.search_id
          WHERE q2.query = q.query AND q2.created_at > now() - make_interval(days => $1))::int AS clicks
       FROM ops.search_queries q WHERE q.created_at > now() - make_interval(days => $1)
       GROUP BY q.query ORDER BY searches DESC, q.query LIMIT 20`,
      window,
    ),
    db.query<{ query: string; searches: number; last_seen: Date }>(
      `SELECT query, count(*)::int AS searches, max(created_at) AS last_seen
       FROM ops.search_queries WHERE result_count = 0 AND created_at > now() - make_interval(days => $1)
       GROUP BY query ORDER BY searches DESC, query LIMIT 50`,
      window,
    ),
    db.query<{ position: number; clicks: number }>(
      `SELECT c.position, count(*)::int AS clicks FROM ops.search_clicks c
       JOIN ops.search_queries q ON q.id = c.search_id
       WHERE q.created_at > now() - make_interval(days => $1)
       GROUP BY c.position ORDER BY c.position`,
      window,
    ),
  ])
  const t = totals.rows[0]
  const rate = (n: number) => (t.searches ? Math.round((n / t.searches) * 1000) / 1000 : 0)
  return {
    from: new Date(t.from).toISOString(),
    to: new Date(t.to).toISOString(),
    searches: t.searches,
    zeroResultRate: rate(t.zero),
    clickThroughRate: rate(t.clicked),
    meanClickPosition: t.mean === null ? null : Math.round(Number(t.mean) * 100) / 100,
    topQueries: top.rows.map((r) => ({
      query: r.query,
      searches: r.searches,
      avgResults: Math.round(Number(r.avg_results) * 10) / 10,
      clicks: r.clicks,
    })),
    zeroResultQueries: zero.rows.map((r) => ({
      query: r.query,
      searches: r.searches,
      lastSeen: new Date(r.last_seen).toISOString(),
    })),
    clickPositions: positions.rows,
  }
}
