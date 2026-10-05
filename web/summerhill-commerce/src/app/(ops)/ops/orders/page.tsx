import type { Metadata } from 'next'

import { listMerchants } from '@/modules/merchant'
import { ORDER_STATUSES } from '@/modules/ordering'
import { searchOrders } from '@/modules/reporting'

import { A, Badge, cad, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'

export const metadata: Metadata = { title: 'Orders' }
export const dynamic = 'force-dynamic'

/** Order search (G5-03, A5): by order id, email or pickup name; filters by status and store. */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const ops = await requireOpsPage('/ops/orders', 'orders.read')
  if (!ops) return <NotAuthorised />
  const sp = await searchParams
  const status = ORDER_STATUSES.includes(sp.status as never) ? sp.status : undefined
  const merchantId = Number(sp.merchant) > 0 ? Number(sp.merchant) : undefined
  const [orders, merchants] = await Promise.all([
    searchOrders({
      q: sp.q?.slice(0, 100),
      status,
      merchantId,
      hasIssue: sp.issues === '1' ? true : undefined,
      limit: 100,
    }),
    listMerchants(),
  ])
  const rated = orders.filter((o) => o.rating !== null)
  const average = rated.length ? rated.reduce((s, o) => s + o.rating!, 0) / rated.length : null
  return (
    <div>
      <PageTitle
        sub={`${orders.length} shown${average !== null ? ` · average rating ${average.toFixed(1)} / 5 (${rated.length} rated)` : ''}`}
      >
        Orders
      </PageTitle>
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" role="search">
        <label>
          <span className="block">Order id, email or pickup name</span>
          <input name="q" defaultValue={sp.q ?? ''} className="rounded border px-2 py-1" />
        </label>
        <label>
          <span className="block">Status</span>
          <select name="status" defaultValue={status ?? ''} className="rounded border px-2 py-1">
            <option value="">Any</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block">Store</span>
          <select
            name="merchant"
            defaultValue={merchantId ?? ''}
            className="rounded border px-2 py-1"
          >
            <option value="">Any</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="issues" value="1" defaultChecked={sp.issues === '1'} /> with
          a reported problem
        </label>
        <button className="rounded bg-[#1F3A2E] px-3 py-1.5 text-white">Search</button>
      </form>
      <Section title="Results">
        <Table
          head={['Order', 'Store', 'Status', 'Customer', 'Total', 'Refunds', 'Flags', 'Created']}
          rows={orders.map((o) => [
            <A key="o" href={`/ops/orders/${o.publicId}`}>
              <span className="font-mono">{o.publicId}</span>
            </A>,
            o.merchant,
            <Badge key="s" value={o.status} />,
            o.email,
            cad(o.totalCents),
            o.refundStatus === 'none' ? '' : o.refundStatus,
            [o.openIssues ? `${o.openIssues} open issue(s)` : '', o.disputes ? 'disputed' : '']
              .filter(Boolean)
              .join(', '),
            when(o.createdAt),
          ])}
        />
      </Section>
    </div>
  )
}
