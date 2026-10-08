import type { Actor } from '@/modules/ops'
import { getOrderLines, recordPick, transitionInTx } from '@/modules/ordering'
import { withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

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
