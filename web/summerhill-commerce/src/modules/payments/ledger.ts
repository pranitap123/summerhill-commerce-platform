import type { Db } from '@/server/db'
import { getDb } from '@/server/db'

import { isBalanced, type LedgerEntry } from './ledgerRules'

/**
 * Writes one balanced journal (PAYMENTS §9). The journal key (e.g. `capture:42`) is unique, so
 * posting the same money event twice is a no-op; returns false in that case. The database checks
 * the balance again at commit (finance.assert_journal_balanced) and app_rw can't UPDATE or DELETE.
 */
export async function postJournal(
  tx: Db,
  journal: {
    key: string
    event: string
    orderId: number | null
    externalRef?: string | null
    entries: LedgerEntry[]
  },
): Promise<boolean> {
  if (!isBalanced(journal.entries)) throw new Error(`journal ${journal.key} is not balanced`)
  if (journal.entries.length === 0) return false
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO finance.ledger_journals (idempotency_key, event, order_id, external_ref)
     VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [journal.key, journal.event, journal.orderId, journal.externalRef ?? null],
  )
  if (!rows[0]) return false
  for (const e of journal.entries)
    await tx.query(
      `INSERT INTO finance.ledger_entries (journal_id, order_id, account, debit_cents, credit_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, journal.orderId, e.account, e.debitCents, e.creditCents],
    )
  return true
}

export interface AccountBalance {
  account: string
  debitCents: number
  creditCents: number
}

/** Per-account totals for one order (order page, reconciliation, tests). */
export async function getOrderLedger(orderId: number, db: Db = getDb()): Promise<AccountBalance[]> {
  const { rows } = await db.query<{ account: string; debit: string; credit: string }>(
    `SELECT account, sum(debit_cents) AS debit, sum(credit_cents) AS credit
     FROM finance.ledger_entries WHERE order_id = $1 GROUP BY account ORDER BY account`,
    [orderId],
  )
  return rows.map((r) => ({
    account: r.account,
    debitCents: Number(r.debit),
    creditCents: Number(r.credit),
  }))
}
