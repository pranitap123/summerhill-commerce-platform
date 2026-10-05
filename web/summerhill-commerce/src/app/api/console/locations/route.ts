import { accessibleLocations } from '@/modules/fulfilment'
import { route } from '@/server/http'

import { scopeOf } from '../_lib/scope'

/** GET /api/console/locations: the stores the caller can open in the console (G4-05). */
export const GET = route('staff', async (ctx) => ({
  locations: await accessibleLocations(scopeOf(ctx)),
  user: { id: ctx.user!.id, email: ctx.user!.email },
}))
