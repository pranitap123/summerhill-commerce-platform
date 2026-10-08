import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ResetPasswordForm } from './ResetPasswordForm'

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } }

export default function ResetPasswordPage() {
  return (
    <div className="container max-w-lg py-16">
      <h1 className="mb-6 text-2xl font-semibold">Choose a new password</h1>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
