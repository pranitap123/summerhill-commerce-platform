import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { staffScope, type StaffScope } from '@/modules/fulfilment'
import { getSessionUser, hasRole } from '@/modules/identity'
import { listStaffMemberships } from '@/modules/merchant'

/**
 * Page-level check for /console (defence in depth behind src/proxy.ts). Anonymous → the
 * storefront login (store staff are ordinary accounts with a staff membership). Signed in but not
 * staff → null, and the page renders <NotStaff />. Staff without a verified second factor for this
 * session → /mfa (G5-12).
 */
export async function requireStaffPage(path: string): Promise<StaffScope | null> {
  const user = await getSessionUser(await headers())
  if (!user) redirect(`/login?redirect=${encodeURIComponent(path)}`)
  const memberships = await listStaffMemberships(String(user.id))
  if (!memberships.length && !hasRole(user, ['admin'])) return null
  if (!user.mfaVerified) redirect(`/mfa?redirect=${encodeURIComponent(path)}`)
  return staffScope(user, memberships)
}
