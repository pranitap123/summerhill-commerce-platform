import { listFlags } from '@/modules/ops'
import { route } from '@/server/http'

/** GET /api/admin/flags (G5-10, A13): kill switches and feature flags. */
export const GET = route('admin', async () => ({ flags: await listFlags() }), {
  permission: 'flags.manage',
})
