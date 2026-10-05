import Link from 'next/link'

export function ConsoleHeader({
  title,
  locationId,
  back,
}: {
  title: string
  locationId?: number
  back?: { href: string; label: string }
}) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-neutral-300 bg-[#1F3A2E] px-4 py-3 text-white">
      {back && (
        <Link href={back.href} className="rounded border border-white/40 px-3 py-1 text-sm">
          ← {back.label}
        </Link>
      )}
      <h1 className="font-display flex-1 text-xl">{title}</h1>
      {locationId && (
        <nav aria-label="Console" className="flex gap-3 text-sm">
          <Link href={`/console/${locationId}`} className="underline-offset-4 hover:underline">
            Orders
          </Link>
          <Link
            href={`/console/${locationId}/availability`}
            className="underline-offset-4 hover:underline"
          >
            Out of stock
          </Link>
          <Link
            href={`/console/${locationId}/settings`}
            className="underline-offset-4 hover:underline"
          >
            Settings
          </Link>
          <Link
            href={`/console/${locationId}/finance`}
            className="underline-offset-4 hover:underline"
          >
            Sales &amp; payouts
          </Link>
        </nav>
      )}
    </header>
  )
}
