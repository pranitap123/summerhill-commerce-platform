import { listCategories } from '@/modules/catalog'
import { route } from '@/server/http'

export const GET = route('public', async () => ({ categories: await listCategories() }))
