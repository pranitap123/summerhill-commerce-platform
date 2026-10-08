import { NextResponse } from 'next/server'

import { beginEnrolment, getMfaStatus, isPlatformStaff } from '@/modules/identity'
import { listStaffMemberships } from '@/modules/merchant'
import { HttpError, route } from '@/server/http'

async function requireStaff(user: Parameters<typeof isPlatformStaff>[0]) {
  if (!isPlatformStaff(user) && !(await listStaffMemberships(String(user!.id))).length)
    throw new HttpError(409, 'MFA_NOT_APPLICABLE', 'Two-step verification is for staff accounts')
}

export const GET = route('customer', async ({ user }) => ({
  ...(await getMfaStatus(String(user!.id))),
  verified: !!user!.mfaVerified,
}))

export const POST = route('customer', async ({ user }) => {
  await requireStaff(user)
  const enrolment = await beginEnrolment(String(user!.id), user!.email)
  return NextResponse.json(enrolment, { headers: { 'cache-control': 'no-store' } })
})
