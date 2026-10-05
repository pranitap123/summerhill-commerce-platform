import Link from 'next/link'

export function NotStaff({ what = 'the store console' }: { what?: string }) {
  return (
    <div role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="font-display mb-2 text-3xl text-[#1F3A2E]">Not available</h1>
      <p>
        Your account doesn&apos;t have access to {what}. Ask the store owner to add you, or{' '}
        <Link href="/logout" className="underline">
          sign in with another account
        </Link>
        .
      </p>
    </div>
  )
}
