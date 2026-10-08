import type { Metadata } from 'next'

import { searchAuditLog } from '@/modules/ops'

import { PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

const text = (v: string | undefined, max: number) =>
  v?.trim() ? v.trim().slice(0, max) : undefined

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const ops = await requireOpsPage('/ops/audit', 'audit.read')
  if (!ops) return <NotAuthorised />
  const sp = await searchParams
  const filter = {
    actorId: text(sp.actor, 64),
    action: text(sp.action, 64),
    targetType: text(sp.targetType, 32),
    targetId: text(sp.targetId, 64),
    before: Number(sp.before) > 0 ? Number(sp.before) : undefined,
    limit: 100,
  }
  const entries = await searchAuditLog(filter)
  const next = entries.length === 100 ? entries.at(-1)!.id : null
  const qs = new URLSearchParams(
    Object.entries({
      actor: filter.actorId,
      action: filter.action,
      targetType: filter.targetType,
      targetId: filter.targetId,
    }).filter(([, v]) => v) as Array<[string, string]>,
  )
  return (
    <div>
      <PageTitle sub="Every admin change and money action: who, what, when, from where.">
        Audit log
      </PageTitle>
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm">
        {[
          ['actor', 'Actor id', filter.actorId],
          ['action', 'Action starts with', filter.action],
          ['targetType', 'Target type', filter.targetType],
          ['targetId', 'Target id', filter.targetId],
        ].map(([name, label, value]) => (
          <label key={name}>
            <span className="block">{label}</span>
            <input name={name} defaultValue={value ?? ''} className="rounded border px-2 py-1" />
          </label>
        ))}
        <button className="rounded bg-[#1F3A2E] px-3 py-1.5 text-white">Filter</button>
      </form>
      <Section title={`Entries${entries.length ? ` (${entries.length} shown)` : ''}`}>
        <Table
          head={['When', 'Actor', 'Action', 'Target', 'Details', 'From']}
          empty="No entries match."
          rows={entries.map((e) => [
            when(e.at),
            `${e.actorType}${e.actorId ? `:${e.actorId}` : ''}`,
            <code key="a">{e.action}</code>,
            `${e.targetType}${e.targetId ? ` ${e.targetId}` : ''}`,
            <details key="d">
              <summary className="cursor-pointer text-xs">data</summary>
              <pre className="max-w-xl whitespace-pre-wrap text-xs">
                {JSON.stringify(e.data, null, 2)}
              </pre>
            </details>,
            <span key="f" className="text-xs text-neutral-600">
              {e.ip ?? '–'}
              <br />
              {e.requestId ?? ''}
            </span>,
          ])}
        />
        {next && (
          <p className="mt-3 text-sm">
            <a
              className="underline"
              href={`/ops/audit?${qs.toString()}${qs.size ? '&' : ''}before=${next}`}
            >
              Older entries →
            </a>
          </p>
        )}
      </Section>
    </div>
  )
}
