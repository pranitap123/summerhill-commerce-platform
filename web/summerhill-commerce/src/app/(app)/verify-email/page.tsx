import configPromise from '@payload-config'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } }

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  let ok = false
  if (token && /^[A-Za-z0-9]{10,200}$/.test(token)) {
    const payload = await getPayload({ config: configPromise })
    ok = await payload.verifyEmail({ collection: 'users', token }).catch(() => false)
  }
  return (
    <div className="container max-w-lg py-16">
      <h1 className="mb-4 text-2xl font-semibold">
        {ok ? 'Email confirmed' : 'This link is invalid or has already been used'}
      </h1>
      <p>
        {ok ? (
          <>
            Thanks! You can now <Link href="/login">log in</Link>.
          </>
        ) : (
          <>
            If you already confirmed your email, just <Link href="/login">log in</Link>.
          </>
        )}
      </p>
    </div>
  )
}
