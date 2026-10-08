import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import { parseFeeSchedule, type FeeSchedule } from './fees'

export async function getActiveFeeSchedule(
  merchantId: number,
  at: Date = new Date(),
  db: Db = getDb(),
): Promise<FeeSchedule> {
  const { rows } = await db.query<{
    id: string
    mode: string
    tiers: unknown
    hst_on_commission: boolean
  }>(
    `SELECT id, mode, tiers, hst_on_commission FROM finance.fee_schedules
     WHERE (merchant_id = $1 OR merchant_id IS NULL) AND effective_from <= $2
     ORDER BY (merchant_id IS NULL), effective_from DESC, id DESC
     LIMIT 1`,
    [merchantId, at],
  )
  if (!rows[0]) throw new Error('no fee schedule in force (migration 005 inserts the default)')
  return parseFeeSchedule({ ...rows[0], id: Number(rows[0].id) })
}

export async function getFeeSchedule(id: number, db: Db = getDb()): Promise<FeeSchedule> {
  const { rows } = await db.query<{
    id: string
    mode: string
    tiers: unknown
    hst_on_commission: boolean
  }>('SELECT id, mode, tiers, hst_on_commission FROM finance.fee_schedules WHERE id = $1', [id])
  if (!rows[0]) throw new Error(`fee schedule ${id} not found`)
  return parseFeeSchedule({ ...rows[0], id: Number(rows[0].id) })
}
