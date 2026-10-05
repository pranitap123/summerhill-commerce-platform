import Link from 'next/link'
import type { ReactNode } from 'react'

/** Small presentational pieces shared by the /ops pages (server-safe). */
export const cad = (cents: number | string | null | undefined) =>
  cents === null || cents === undefined
    ? '–'
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(
        Number(cents) / 100,
      )

export const when = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '–'

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-3xl text-[#1F3A2E]">{children}</h1>
      {sub && <p className="mt-1 text-sm text-neutral-700">{sub}</p>}
    </div>
  )
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="mb-8 rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const TONES = {
  good: 'bg-[#E3EFE6] text-[#1F3A2E]',
  warn: 'bg-[#FFF1D6] text-[#6B4A00]',
  bad: 'bg-[#FBE3E1] text-[#8A1C14]',
  neutral: 'bg-neutral-100 text-neutral-800',
}
const TONE_OF: Record<string, keyof typeof TONES> = {
  clean: 'good',
  succeeded: 'good',
  paid: 'good',
  won: 'good',
  live: 'good',
  verified: 'good',
  collected: 'good',
  approved: 'good',
  auto_approved: 'good',
  done: 'good',
  applied: 'good',
  mismatches: 'bad',
  failed: 'bad',
  lost: 'bad',
  critical: 'bad',
  rejected: 'bad',
  restricted: 'bad',
  needs_response: 'warn',
  pending_approval: 'warn',
  open: 'warn',
  held: 'warn',
  paused: 'warn',
  warning: 'warn',
  pending: 'warn',
  offboarding: 'warn',
}

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span>–</span>
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[TONE_OF[value] ?? 'neutral']}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  )
}

export function Table({
  head,
  rows,
  empty = 'Nothing here yet.',
}: {
  head: string[]
  rows: ReactNode[][]
  empty?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-neutral-300 py-2 pr-4 text-left font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="py-3 text-neutral-600">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="border-b border-neutral-200 py-2 pr-4 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Dl({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-neutral-600">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-[#1F3A2E] underline underline-offset-2">
    {children}
  </Link>
)

/**
 * A file from an API route (CSV, JSON). A plain link, not next/link: Link prefetches its target on
 * every view and routes clicks through client navigation, which for an export means building the
 * file in the background each time the page is shown.
 */
export const Download = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} download className="text-[#1F3A2E] underline underline-offset-2">
    {children}
  </a>
)
