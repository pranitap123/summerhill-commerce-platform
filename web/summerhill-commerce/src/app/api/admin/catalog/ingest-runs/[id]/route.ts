import { getIngestRun } from '@/modules/catalog'
import { HttpError, idParam, parseParams, route } from '@/server/http'

/** GET /api/admin/catalog/ingest-runs/{id}: one run with its quarantined rows and flags. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => {
    const run = await getIngestRun(parseParams(params, idParam).id)
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'Ingest run not found')
    return run
  },
  { permission: 'catalog.manage' },
)
