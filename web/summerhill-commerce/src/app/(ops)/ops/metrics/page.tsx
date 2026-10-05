import type { Metadata } from 'next'

import { businessDayBounds } from '@/modules/payouts'
import { computeMetrics, METRIC_DEFINITIONS, type MetricName } from '@/modules/reporting'

import { cad, PageTitle, Section, Table } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Metrics' }
export const dynamic = 'force-dynamic'

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`)
const dur = (s: number | null) =>
  s === null ? '–' : s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`

const FORMAT: Record<MetricName, (v: number | null) => string> = {
  ordersPlaced: (v) => String(v ?? 0),
  gmvCents: (v) => cad(v),
  refundedCents: (v) => cad(v),
  conversion: pct,
  fillRate: pct,
  medianAcceptSeconds: dur,
  medianReadySeconds: dur,
  pickupWaitMedianSeconds: dur,
  pickupWaitP90Seconds: dur,
  pickAccuracy: pct,
  problemRate: pct,
  disputeRate: pct,
  repeatRate30d: pct,
}

/** The last 30 days, as YYYY-MM-DD (the clock is read here, not during render). */
function defaultRange(): { from: string; to: string } {
  const now = Date.now()
  return {
    from: new Date(now - 29 * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  }
}

/** Admin metrics (G5-18, PRD §8), each with its written definition. */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const ops = await requireOpsPage('/ops/metrics', 'metrics.read')
  if (!ops) return <NotAuthorised />
  const sp = await searchParams
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined)
  const range = defaultRange()
  const to = valid(sp.to) ?? range.to
  const from = valid(sp.from) ?? range.from
  const metrics = await computeMetrics({
    from: businessDayBounds(from).from,
    to: businessDayBounds(to).to,
  })
  return (
    <div>
      <PageTitle sub={`${from} to ${to} (Toronto business days, inclusive)`}>Metrics</PageTitle>
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block">From</span>
          <input type="date" name="from" defaultValue={from} className="rounded border px-2 py-1" />
        </label>
        <label>
          <span className="block">To</span>
          <input type="date" name="to" defaultValue={to} className="rounded border px-2 py-1" />
        </label>
        <button className="rounded bg-[#1F3A2E] px-3 py-1.5 text-white">Show</button>
      </form>
      <Section title="Metrics">
        <Table
          head={['Metric', 'Value', 'Definition']}
          rows={(Object.keys(METRIC_DEFINITIONS) as MetricName[]).map((k) => [
            k,
            <strong key="v">{FORMAT[k](metrics[k])}</strong>,
            METRIC_DEFINITIONS[k],
          ])}
        />
      </Section>
    </div>
  )
}
