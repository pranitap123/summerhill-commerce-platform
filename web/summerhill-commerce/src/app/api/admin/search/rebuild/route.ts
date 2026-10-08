import { NextResponse } from 'next/server'

import { audit, enqueue } from '@/modules/ops'
import { withTransaction } from '@/server/db'
import { route } from '@/server/http'

export const POST = route('admin', async ({ user, requestId }) => {
  const jobId = await withTransaction(async (tx) => {
    const id = await enqueue(
      tx,
      'search.rebuild',
      {},
      { dedupeKey: `manual:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 1 },
    )
    await audit(tx, {
      actor: { type: 'admin', id: String(user!.id) },
      action: 'search.rebuild',
      targetType: 'search_index',
      targetId: null,
      requestId,
    })
    return id
  })
  return NextResponse.json({ queued: true, jobId }, { status: 202 })
})
