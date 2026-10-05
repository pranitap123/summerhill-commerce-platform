import { listPrivacyRequests } from '@/modules/privacy'
import { route } from '@/server/http'

/** GET /api/admin/privacy: handled data subject requests (no personal data, G5-17). */
export const GET = route('admin', async () => ({ requests: await listPrivacyRequests() }), {
  permission: 'privacy.manage',
})
