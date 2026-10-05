import type { Actor } from '@/modules/ops'
import { getOrderLines, recordPick, transitionInTx } from '@/modules/ordering'
import { withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

/**
 * Demo/test tool until the merchant console exists (G4): walks a placed order through
 * accepted → picking → picked, recording every line as picked. Weighed lines get their estimated
 * weight adjusted by `weightChangePercent` (e.g. +10 → 10% heavier). The `order.picked` outbox
 * event then triggers the `payment.capture` job, exactly as "complete picking" will in G4-13.
 */
export async function fastForwardToPicked(
  orderId: number,
  actor: Actor,
  opts: { weightChangePercent?: number; unavailableLineNos?: number[] } = {},
): Promise<void> {
  const change = opts.weightChangePercent ?? 0
  if (!Number.isInteger(change) || change < -50 || change > 50)
    throw new HttpError(400, 'VALIDATION_FAILED', 'weightChangePercent must be between -50 and 50')
  const unavailable = new Set(opts.unavailableLineNos ?? [])
  await withTransaction(async (tx) => {
    await transitionInTx(tx, orderId, 'placed', 'accepted', actor, { reason: 'demo_fast_forward' })
    await transitionInTx(tx, orderId, 'accepted', 'picking', actor)
    for (const line of await getOrderLines(orderId, tx)) {
      if (unavailable.has(line.lineNo)) {
        await recordPick(tx, line.id, {
          status: 'unavailable',
          pickedQuantity: 0,
          actualWeightMlb: null,
        })
        continue
      }
      const actualWeightMlb =
        line.isWeighed && line.estimatedWeightMlb !== null
          ? Math.max(1, Math.round((line.estimatedWeightMlb * (100 + change)) / 100))
          : null
      await recordPick(tx, line.id, {
        status: 'picked',
        pickedQuantity: line.quantity,
        actualWeightMlb,
      })
    }
    await transitionInTx(tx, orderId, 'picking', 'picked', actor)
  })
}
