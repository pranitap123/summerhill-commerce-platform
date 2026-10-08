import { listCategories } from '@/modules/catalog'
import { route } from '@/server/http'

import { deprecated } from '../products/deprecated'

export const GET = route('public', async () =>
  deprecated({ categories: await listCategories() }, '/api/v1/categories'),
)
