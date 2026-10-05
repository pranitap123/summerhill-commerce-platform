import type { DirectoryUser, Role, UserDirectory } from '@/modules/identity'

/**
 * In-memory stand-in for the Payload user accounts (G5-15, G5-17 integration tests). Records the
 * side effects the real directory has elsewhere: password-setup emails and ended sessions.
 */
export class MemoryDirectory implements UserDirectory {
  users = new Map<string, DirectoryUser & { password: string }>()
  passwordSetupEmails: string[] = []
  endedSessions: string[] = []
  private next = 1000

  add(u: { id?: string; email: string; roles: Role[]; name?: string | null }): DirectoryUser {
    const id = u.id ?? String(++this.next)
    const user = {
      id,
      email: u.email,
      name: u.name ?? null,
      roles: u.roles,
      deactivatedAt: null,
      createdAt: new Date(),
      defaultReplacementPreference: 'best_match',
      password: 'initial',
    }
    this.users.set(id, user)
    return user
  }
  private public(u: DirectoryUser & { password: string }): DirectoryUser {
    const { password: _password, ...rest } = u
    return { ...rest, roles: [...rest.roles] }
  }
  async get(id: string) {
    const u = this.users.get(id)
    return u ? this.public(u) : null
  }
  async findByEmail(email: string) {
    const u = [...this.users.values()].find((x) => x.email === email.trim().toLowerCase())
    return u ? this.public(u) : null
  }
  async list({ roles, ids }: { roles?: readonly Role[]; ids?: string[] }) {
    return [...this.users.values()]
      .filter((u) => u.roles.some((r) => roles?.includes(r)) || ids?.includes(u.id))
      .map((u) => this.public(u))
  }
  async create(input: { email: string; name: string | null; roles: Role[] }) {
    return this.add(input)
  }
  async update(
    id: string,
    patch: Partial<Pick<DirectoryUser, 'email' | 'name' | 'roles' | 'deactivatedAt'>>,
  ) {
    const u = this.users.get(id)
    if (!u) throw new Error(`no user ${id}`)
    Object.assign(u, patch)
    return this.public(u)
  }
  async endSessions(id: string) {
    this.endedSessions.push(id)
  }
  async scramblePassword(id: string) {
    this.users.get(id)!.password = `scrambled-${Math.random()}`
  }
  async sendPasswordSetup(email: string) {
    this.passwordSetupEmails.push(email)
  }
}
