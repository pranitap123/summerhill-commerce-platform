import { listMerchants } from '@/modules/catalog'
import { route } from '@/server/http'

export const GET = route('public', async () => ({ merchants: await listMerchants() }))
