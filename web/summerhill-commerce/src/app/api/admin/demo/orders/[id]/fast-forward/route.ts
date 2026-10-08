import { z } from 'zod'

import { audit, type Actor } from '@/modules/ops'
import { fastForwardToPicked } from '@/modules/payments'
import { getDb } from '@/server/db'
import { assertDemoToolsEnabled, idParam, parseJson, parseParams, route } from '@/server/http'

const body = z
  .object({

    weightChangePercent: z.number().int().min(-50).max(50).default(0),

    unavailableLineNos: z.array(z.number().int().positive()).max(50).default([]),
  })
  .strict()

export const POST = route<{ id: string }>('admin', async ({ req, params, user, requestId }) => {
  assertDemoToolsEnabled()
  const { id } = parseParams(params, idParam)
  const opts = await parseJson(req, body)
  const actor: Actor = { type: 'admin', id: String(user!.id) }
  await fastForwardToPicked(id, actor, opts)
  await audit(getDb(), {
    actor,
    action: 'order.demo_fast_forward',
    targetType: 'order',
    targetId: id,
    data: opts,
    requestId,
  })
  return { status: 'picked', next: 'The worker captures the payment within a few seconds.' }
})
