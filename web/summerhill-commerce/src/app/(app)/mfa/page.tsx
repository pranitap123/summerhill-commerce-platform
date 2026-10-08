import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSafeRedirect } from 'payload/shared'

import { getMfaStatus, getSessionUser, isPlatformStaff } from '@/modules/identity'
import { listStaffMemberships } from '@/modules/merchant'

import { MfaForm } from './MfaForm'

export const metadata: Metadata = { title: 'Two-step verification', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const { redirect: target } = await searchParams
  const next = getSafeRedirect({ fallbackTo: '/console', redirectTo: target ?? '' })
  const user = await getSessionUser(await headers())
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/mfa?redirect=${next}`)}`)
  const staff = isPlatformStaff(user) || (await listStaffMemberships(String(user.id))).length > 0
  if (!staff)
    return (
      <div className="container mx-auto my-12 max-w-xl">
        <h1 className="mb-4 text-3xl">Two-step verification</h1>
        <p>Two-step verification is for staff accounts. Your account doesn&apos;t need it.</p>
      </div>
    )
  if (user.mfaVerified) redirect(next)
  const status = await getMfaStatus(String(user.id))
  return (
    <div className="container mx-auto my-12 max-w-xl">
      <h1 className="mb-4 text-3xl">Two-step verification</h1>
      <MfaForm confirmed={status.confirmed} next={next} email={user.email} />
    </div>
  )
}
