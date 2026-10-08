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

export async function requireAdminPage(path: string): Promise<SessionUser | null> {
  return (await requireOpsPage(path))?.user ?? null
}
