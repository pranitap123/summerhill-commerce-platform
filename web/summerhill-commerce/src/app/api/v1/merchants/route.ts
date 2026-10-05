import { listMerchants } from '@/modules/catalog'
import { route } from '@/server/http'

/** GET /api/v1/merchants: stores on the storefront with their pickup locations (G3-13). */
export const GET = route('public', async () => ({ merchants: await listMerchants() }))
