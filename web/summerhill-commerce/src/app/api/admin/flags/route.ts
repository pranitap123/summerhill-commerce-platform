import { listFlags } from '@/modules/ops'
import { route } from '@/server/http'

export const GET = route('admin', async () => ({ flags: await listFlags() }), {
  permission: 'flags.manage',
})
