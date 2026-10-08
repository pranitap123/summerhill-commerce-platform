import { staffScope, type StaffScope } from '@/modules/fulfilment'
import type { RouteContext } from '@/server/http'

export function scopeOf<P>(ctx: RouteContext<P>): StaffScope {
  return staffScope(ctx.user!, ctx.memberships)
}
