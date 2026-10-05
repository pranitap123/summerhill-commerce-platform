import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  can,
  getSessionUser,
  isPlatformStaff,
  permissionsOf,
  type Permission,
  type SessionUser,
} from '@/modules/identity'

/**
 * Page-level check for /ops (G5-01; defence in depth behind src/proxy.ts, which only checks that a
 * session cookie exists). Anonymous → the sign-in page. Staff without a verified second factor →
 * /mfa (G5-12). Signed in without the page's permission → `null`, and the page renders
 * <NotAuthorised />. (Next's forbidden() is still experimental, so it isn't used here.)
 */
export interface OpsUser {
  user: SessionUser
  permissions: Permission[]
  can: (p: Permission) => boolean
}

export async function requireOpsPage(
  path: string,
  permission: Permission = 'ops.enter',
): Promise<OpsUser | null> {
  const user = await getSessionUser(await headers())
  if (!user) redirect(`/login?redirect=${encodeURIComponent(path)}`)
  if (!isPlatformStaff(user)) return null
  if (!user.mfaVerified) redirect(`/mfa?redirect=${encodeURIComponent(path)}`)
  if (!can(user, permission)) return null
  return { user, permissions: permissionsOf(user), can: (p) => can(user, p) }
}

/** Kept for the pre-G5 pages' import name. */
export async function requireAdminPage(path: string): Promise<SessionUser | null> {
  return (await requireOpsPage(path))?.user ?? null
}
