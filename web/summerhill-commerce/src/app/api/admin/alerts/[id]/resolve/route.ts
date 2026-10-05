import { resolveAlert } from '@/modules/ops'
import { HttpError, idParam, parseParams, route } from '@/server/http'

/** POST /api/admin/alerts/{id}/resolve: mark an alert handled. Audited. */
export const POST = route<{ id: string }>(
  'admin',
  async ({ params, audit }) => {
    const { id } = parseParams(params, idParam)
    if (!(await resolveAlert(id)))
      throw new HttpError(404, 'NOT_FOUND', 'No open alert with this id')
    await audit({ action: 'alert.resolve', targetType: 'alert', targetId: id })
    return { resolved: true }
  },
  { permission: 'ops.enter' },
)
