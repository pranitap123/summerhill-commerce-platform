import { listReconRuns, runReconciliation } from '@/modules/payouts'
import { HttpError, parseJson, route } from '@/server/http'

import { reconRunBody } from '../_lib/schemas'

/** GET /api/admin/reconciliation: recent runs (daily at 06:00 for the previous day, and manual). */
export const GET = route('admin', async () => ({ runs: await listReconRuns() }), {
  permission: 'recon.run',
})

/** POST: reconcile one business day now (G5-05). */
export const POST = route(
  'admin',
  async ({ req, user, audit }) => {
    const { runDate } = await parseJson(req, reconRunBody)
    const run = await runReconciliation({
      runDate,
      trigger: 'manual',
      requestedBy: String(user!.id),
    })
    if (!run)
      throw new HttpError(409, 'ALREADY_RUNNING', 'A run for this day is already in progress')
    await audit({
      action: 'recon.run',
      targetType: 'recon_run',
      targetId: run.id,
      data: { runDate, status: run.status },
    })
    return Response.json(run, { status: 201 })
  },
  { permission: 'recon.run' },
)
