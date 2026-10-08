import { isMfaCookieValid, MFA_COOKIE, readCookie } from './mfa'
import type { Role, SessionUser } from './roles'

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('@payload-config'),
  ])
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })
  if (!user) return null
  if ('deactivatedAt' in user && user.deactivatedAt) return null
  const roles = (('roles' in user ? user.roles : undefined) ?? []) as Role[]
  const pref =
    'defaultReplacementPreference' in user ? user.defaultReplacementPreference : undefined
  const sessionId = (user as { _sid?: string })._sid ?? null
  return {
    id: user.id,
    email: user.email ?? '',
    roles,
    defaultReplacementPreference: pref === 'refund' ? 'refund' : 'best_match',
    sessionId,
    mfaVerified: isMfaCookieValid(readCookie(headers, MFA_COOKIE), String(user.id), sessionId),
  }
}
