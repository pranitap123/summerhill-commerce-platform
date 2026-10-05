import { listCategories } from '@/modules/catalog'
import { route } from '@/server/http'

/** GET /api/v1/categories: the category tree with visible-product counts (G3-09, G3-14). */
export const GET = route('public', async () => ({ categories: await listCategories() }))
