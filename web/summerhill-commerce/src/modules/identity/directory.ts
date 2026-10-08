import { randomBytes } from 'node:crypto'

import type { Where } from 'payload'

import { ROLES, type Role } from './roles'

export interface DirectoryUser {
  id: string
  email: string
  name: string | null
  roles: Role[]
  deactivatedAt: Date | null
  createdAt: Date
  defaultReplacementPreference: string | null
}

export interface UserDirectory {
  get(id: string): Promise<DirectoryUser | null>
  findByEmail(email: string): Promise<DirectoryUser | null>

  list(filter: { roles?: readonly Role[]; ids?: string[] }): Promise<DirectoryUser[]>

  create(input: { email: string; name: string | null; roles: Role[] }): Promise<DirectoryUser>
  update(
    id: string,
    patch: Partial<Pick<DirectoryUser, 'email' | 'name' | 'roles' | 'deactivatedAt'>>,
  ): Promise<DirectoryUser>

  endSessions(id: string): Promise<void>

  scramblePassword(id: string): Promise<void>

  sendPasswordSetup(email: string): Promise<void>
}

type PayloadUser = {
  id: string | number
  email?: string | null
  name?: string | null
  roles?: string[] | null
  deactivatedAt?: string | null
  createdAt: string
  defaultReplacementPreference?: string | null
}

function toDirectoryUser(u: PayloadUser): DirectoryUser {
  return {
    id: String(u.id),
    email: u.email ?? '',
    name: u.name ?? null,
    roles: (u.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
    deactivatedAt: u.deactivatedAt ? new Date(u.deactivatedAt) : null,
    createdAt: new Date(u.createdAt),
    defaultReplacementPreference: u.defaultReplacementPreference ?? null,
  }
}

async function payload() {
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('@payload-config'),
  ])
  return getPayload({ config })
}

const randomPassword = () => randomBytes(24).toString('base64url')

export const payloadDirectory: UserDirectory = {
  async get(id) {
    const p = await payload()
    const u = await p
      .findByID({ collection: 'users', id, overrideAccess: true, depth: 0 })
      .catch(() => null)
    return u ? toDirectoryUser(u as PayloadUser) : null
  },
  async findByEmail(email) {
    const p = await payload()
    const { docs } = await p.find({
      collection: 'users',
      where: { email: { equals: email.trim().toLowerCase() } },
      limit: 1,
      overrideAccess: true,
      depth: 0,
    })
    return docs[0] ? toDirectoryUser(docs[0] as PayloadUser) : null
  },
  async list({ roles, ids }) {
    const p = await payload()
    const or: Where[] = []
    if (roles?.length) or.push({ roles: { in: [...roles] } })
    if (ids?.length) or.push({ id: { in: ids } })
    if (!or.length) return []
    const { docs } = await p.find({
      collection: 'users',
      where: { or },
      limit: 500,
      sort: 'email',
      overrideAccess: true,
      depth: 0,
    })
    return docs.map((d) => toDirectoryUser(d as PayloadUser))
  },
  async create({ email, name, roles }) {
    const p = await payload()
    const u = await p.create({
      collection: 'users',
      data: {
        email: email.trim().toLowerCase(),
        name: name ?? undefined,
        roles: roles as never,
        password: randomPassword(),
        _verified: true,
      },
      disableVerificationEmail: true,
      overrideAccess: true,
    })
    return toDirectoryUser(u as PayloadUser)
  },
  async update(id, patch) {
    const p = await payload()
    const data: Record<string, unknown> = {}
    if (patch.email !== undefined) data.email = patch.email
    if (patch.name !== undefined) data.name = patch.name
    if (patch.roles !== undefined) data.roles = patch.roles
    if (patch.deactivatedAt !== undefined)
      data.deactivatedAt = patch.deactivatedAt?.toISOString() ?? null
    const u = await p.update({ collection: 'users', id, data, overrideAccess: true, depth: 0 })
    return toDirectoryUser(u as PayloadUser)
  },
  async endSessions(id) {
    const p = await payload()
    await p.db.updateOne({ collection: 'users', id, data: { sessions: [] }, returning: false })
  },
  async scramblePassword(id) {
    const p = await payload()
    await p.update({
      collection: 'users',
      id,
      data: { password: randomPassword() },
      overrideAccess: true,
    })
  },
  async sendPasswordSetup(email) {
    const p = await payload()
    await p.forgotPassword({ collection: 'users', data: { email }, disableEmail: false })
  },
}

let override: UserDirectory | undefined

export function getUserDirectory(): UserDirectory {
  return override ?? payloadDirectory
}

export function setUserDirectoryForTests(directory: UserDirectory | undefined): void {
  override = directory
}
