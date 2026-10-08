import { listPrivacyRequests } from '@/modules/privacy'
import { route } from '@/server/http'

export const GET = route('admin', async () => ({ requests: await listPrivacyRequests() }), {
  permission: 'privacy.manage',
})
