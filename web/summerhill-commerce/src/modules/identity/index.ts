// Public API of the identity module: sessions, platform roles and permissions, staff MFA, and
// user management over the Payload accounts.
export { getSessionUser } from './auth'
export { hasRole, isPlatformStaff, PLATFORM_ROLES, ROLES } from './roles'
export type { Role, PlatformRole, SessionUser } from './roles'
export {
  can,
  permissionsOf,
  PERMISSIONS,
  SUPPORT_REFUND_LIMIT_CENTS,
  PAYOUT_APPROVAL_THRESHOLD_CENTS,
} from './permissions'
export type { Permission } from './permissions'
export {
  MFA_COOKIE,
  MFA_SESSION_MS,
  getMfaStatus,
  beginEnrolment,
  verifyMfaCode,
  resetMfa,
  reencryptMfaSecrets,
  enrolWithSecret,
  mfaCookieValue,
  isMfaCookieValid,
  readCookie,
} from './mfa'
export type { MfaStatus } from './mfa'
export { totp, verifyTotp, generateTotpSecret, otpauthUri, base32Decode } from './totp'
export { getUserDirectory, setUserDirectoryForTests, payloadDirectory } from './directory'
export type { DirectoryUser, UserDirectory } from './directory'
export {
  listTeam,
  inviteUser,
  changeRoles,
  deactivateUser,
  reactivateUser,
  resetUserMfa,
  setMembership,
  removeMembership,
} from './users'
export type { TeamMember } from './users'
