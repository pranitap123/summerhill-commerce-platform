import { staffScope, type StaffScope } from '@/modules/fulfilment'
import type { RouteContext } from '@/server/http'

/** The caller as the fulfilment module sees them (route() already required a staff session). */
export function scopeOf<P>(ctx: RouteContext<P>): StaffScope {
  return staffScope(ctx.user!, ctx.memberships)
}
