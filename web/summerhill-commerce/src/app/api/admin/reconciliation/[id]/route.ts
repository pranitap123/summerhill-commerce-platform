import { getReconRun } from '@/modules/payouts'
import { HttpError, idParam, parseParams, route } from '@/server/http'

export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => {
    const run = await getReconRun(parseParams(params, idParam).id)
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run not found')
    return run
  },
  { permission: 'recon.run' },
)
