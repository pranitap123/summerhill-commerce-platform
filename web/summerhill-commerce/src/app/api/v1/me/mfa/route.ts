import { NextResponse } from 'next/server'

import { beginEnrolment, getMfaStatus, isPlatformStaff } from '@/modules/identity'
import { listStaffMemberships } from '@/modules/merchant'
import { HttpError, route } from '@/server/http'

async function requireStaff(user: Parameters<typeof isPlatformStaff>[0]) {
  if (!isPlatformStaff(user) && !(await listStaffMemberships(String(user!.id))).length)
    throw new HttpError(409, 'MFA_NOT_APPLICABLE', 'Two-step verification is for staff accounts')
}

/** GET /api/v1/me/mfa (G5-12): enrolled? verified for this session? */
export const GET = route('customer', async ({ user }) => ({
  ...(await getMfaStatus(String(user!.id))),
  verified: !!user!.mfaVerified,
}))

/**
 * POST /api/v1/me/mfa: start (or restart, until confirmed) enrolment. Returns the secret once, as
 * a key and an otpauth:// URI for the authenticator app. Staff only.
 */
export const POST = route('customer', async ({ user }) => {
  await requireStaff(user)
  const enrolment = await beginEnrolment(String(user!.id), user!.email)
  return NextResponse.json(enrolment, { headers: { 'cache-control': 'no-store' } })
})
