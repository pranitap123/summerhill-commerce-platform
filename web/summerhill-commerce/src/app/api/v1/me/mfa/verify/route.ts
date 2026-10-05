import { NextResponse } from 'next/server'

import { MFA_COOKIE, mfaCookieValue, verifyMfaCode } from '@/modules/identity'
import { getConfig } from '@/server/config'
import { HttpError, parseJson, route } from '@/server/http'

import { mfaVerifyBody } from '../../../../admin/_lib/schemas'

/**
 * POST /api/v1/me/mfa/verify (G5-12): checks a 6-digit code (5 tries per 5 min) and marks this
 * session as verified with an HttpOnly cookie bound to the session. The first code confirms
 * enrolment.
 */
export const POST = route('customer', async ({ req, user }) => {
  const { code } = await parseJson(req, mfaVerifyBody)
  if (!user!.sessionId)
    throw new HttpError(
      409,
      'NO_SESSION',
      'Sign in with your password first (API keys cannot verify)',
    )
  await verifyMfaCode(String(user!.id), code.trim())
  const cookie = mfaCookieValue(String(user!.id), user!.sessionId)
  const res = NextResponse.json({ verified: true })
  res.cookies.set(MFA_COOKIE, cookie.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().isProduction,
    path: '/',
    maxAge: cookie.maxAgeSeconds,
  })
  return res
})
