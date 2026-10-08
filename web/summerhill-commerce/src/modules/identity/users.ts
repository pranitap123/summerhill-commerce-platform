import {
  deactivateStaffMemberships,
  listAllStaffMemberships,
  upsertStaffMembership,
  type StaffMembershipRow,
  type StaffRole,
} from '@/modules/merchant'
import { audit, type AuditContext } from '@/modules/ops'
import { getDb, withTransaction } from '@/server/db'
import { HttpError } from '@/server/http'

import { getUserDirectory, type DirectoryUser } from './directory'
import { getMfaStatus, resetMfa, type MfaStatus } from './mfa'
import { PLATFORM_ROLES, type Role } from './roles'

export interface TeamMember extends DirectoryUser {
  mfa: MfaStatus
  memberships: StaffMembershipRow[]
}

export async function listTeam(): Promise<TeamMember[]> {
  const memberships = await listAllStaffMemberships()
  const staffIds = [...new Set(memberships.map((m) => m.userId))]
  const users = await getUserDirectory().list({ roles: PLATFORM_ROLES, ids: staffIds })
  return Promise.all(
    users.map(async (u) => ({
      ...u,
      mfa: await getMfaStatus(u.id),
      memberships: memberships.filter((m) => m.userId === u.id),
    })),
  )
}

async function requireUser(id: string): Promise<DirectoryUser> {
  const user = await getUserDirectory().get(id)
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found')
  return user
}

async function activeAdminCount(): Promise<number> {
  const admins = await getUserDirectory().list({ roles: ['admin'] })
  return admins.filter((a) => !a.deactivatedAt).length
}

async function assertNotLastAdmin(target: DirectoryUser): Promise<void> {
  if (!target.roles.includes('admin') || target.deactivatedAt) return
  if ((await activeAdminCount()) <= 1)
    throw new HttpError(409, 'LAST_ADMIN', 'This is the last active admin; add another admin first')
}

function assertNotSelf(ctx: AuditContext, userId: string, what: string): void {
  if (ctx.actor.id === userId)
    throw new HttpError(409, 'SELF_CHANGE', `You can't ${what} your own account`)
}

const normaliseRoles = (roles: Role[]): Role[] => {
  const set = new Set(roles)
  set.add('customer')
  return [...set].sort()
}

export async function inviteUser(
  ctx: AuditContext,
  input: {
    email: string
    name: string | null
    roles: Role[]
    membership?: { merchantId: number; locationId: number | null; role: StaffRole }
  },
): Promise<DirectoryUser> {
  const directory = getUserDirectory()
  const email = input.email.trim().toLowerCase()
  const existing = await directory.findByEmail(email)
  if (existing?.deactivatedAt)
    throw new HttpError(409, 'USER_DEACTIVATED', 'This account is deactivated; reactivate it first')
  const roles = normaliseRoles([...(existing?.roles ?? []), ...input.roles])
  const user = existing
    ? await directory.update(existing.id, { roles })
    : await directory.create({ email, name: input.name, roles })
  if (input.membership)
    await upsertStaffMembership(getDb(), { userId: user.id, ...input.membership })
  if (!existing) await directory.sendPasswordSetup(email)
  await audit(getDb(), {
    ...ctx,
    action: 'user.invite',
    targetType: 'user',
    targetId: user.id,
    data: {
      email,
      existing: !!existing,
      before: existing ? { roles: existing.roles } : null,
      after: { roles },
      membership: input.membership ?? null,
    },
  })
  return user
}

export async function changeRoles(
  ctx: AuditContext,
  userId: string,
  roles: Role[],
): Promise<DirectoryUser> {
  assertNotSelf(ctx, userId, 'change the roles of')
  const target = await requireUser(userId)
  const next = normaliseRoles(roles)
  if (target.roles.includes('admin') && !next.includes('admin')) await assertNotLastAdmin(target)
  const updated = await getUserDirectory().update(userId, { roles: next })
  await audit(getDb(), {
    ...ctx,
    action: 'user.roles',
    targetType: 'user',
    targetId: userId,
    data: { before: { roles: target.roles }, after: { roles: next } },
  })
  return updated
}

export async function deactivateUser(ctx: AuditContext, userId: string): Promise<DirectoryUser> {
  assertNotSelf(ctx, userId, 'deactivate')
  const target = await requireUser(userId)
  if (target.deactivatedAt) return target
  await assertNotLastAdmin(target)
  const directory = getUserDirectory()
  const updated = await directory.update(userId, { deactivatedAt: new Date() })
  await directory.endSessions(userId)
  await withTransaction(async (tx) => {
    const memberships = await deactivateStaffMemberships(tx, userId)
    await audit(tx, {
      ...ctx,
      action: 'user.deactivate',
      targetType: 'user',
      targetId: userId,
      data: { email: target.email, roles: target.roles, sessionsEnded: true, memberships },
    })
  })
  return updated
}

export async function reactivateUser(ctx: AuditContext, userId: string): Promise<DirectoryUser> {
  const target = await requireUser(userId)
  if (!target.deactivatedAt) return target
  const updated = await getUserDirectory().update(userId, { deactivatedAt: null })
  await audit(getDb(), {
    ...ctx,
    action: 'user.reactivate',
    targetType: 'user',
    targetId: userId,
    data: { email: target.email },
  })
  return updated
}

export async function resetUserMfa(ctx: AuditContext, userId: string): Promise<void> {
  const target = await requireUser(userId)
  const removed = await resetMfa(userId)
  await getUserDirectory().endSessions(userId)
  await audit(getDb(), {
    ...ctx,
    action: 'user.mfa_reset',
    targetType: 'user',
    targetId: userId,
    data: { email: target.email, hadMfa: removed },
  })
}

export async function setMembership(
  ctx: AuditContext,
  userId: string,
  membership: { merchantId: number; locationId: number | null; role: StaffRole },
): Promise<void> {
  const target = await requireUser(userId)
  if (target.deactivatedAt)
    throw new HttpError(409, 'USER_DEACTIVATED', 'This account is deactivated')
  const before = (await listAllStaffMemberships()).find(
    (m) => m.userId === userId && m.merchantId === membership.merchantId,
  )
  await upsertStaffMembership(getDb(), { userId, ...membership })
  await audit(getDb(), {
    ...ctx,
    action: 'user.membership_set',
    targetType: 'user',
    targetId: userId,
    data: {
      before: before
        ? { role: before.role, locationId: before.locationId, active: before.active }
        : null,
      after: membership,
    },
  })
}

export async function removeMembership(
  ctx: AuditContext,
  userId: string,
  merchantId: number,
): Promise<void> {
  await withTransaction(async (tx) => {
    const changed = await deactivateStaffMemberships(tx, userId, merchantId)
    if (!changed) throw new HttpError(404, 'NOT_FOUND', 'No active membership for that store')
    await audit(tx, {
      ...ctx,
      action: 'user.membership_remove',
      targetType: 'user',
      targetId: userId,
      data: { merchantId },
    })
  })
}
