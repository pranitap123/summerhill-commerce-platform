import type { Metadata } from 'next'

import {
  listCategoryMappings,
  listIngestRequests,
  listIngestRuns,
  listSubcategories,
} from '@/modules/catalog'
import { listMerchants } from '@/modules/merchant'
import { getDb } from '@/server/db'

import { ActionButton } from '../_components/actions'
import { Badge, cad, PageTitle, Section, Table, when } from '../_components/ui'
import { NotAuthorised } from '../NotAuthorised'
import { requireOpsPage } from '../requireAdminPage'
import { MappingSelect, OverrideForm, RequestRun } from './CatalogForms'

export const metadata: Metadata = { title: 'Catalogue' }
export const dynamic = 'force-dynamic'

/**
 * Catalogue admin (G5-14, A3/A4): ingest runs, held-run decisions, re-runs, the category-mapping
 * editor and product overrides. Approvals and runs are carried out by the pipeline (Dagster
 * sensor every 30 s, or `npm run pipeline:requests`).
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const ops = await requireOpsPage('/ops/catalog', 'catalog.manage')
  if (!ops) return <NotAuthorised />
  const { q } = await searchParams
  const query = q?.trim().slice(0, 100)
  const [runs, requests, mappings, subcategories, merchants, products] = await Promise.all([
    listIngestRuns(20),
    listIngestRequests(10),
    listCategoryMappings(),
    listSubcategories(),
    listMerchants(),
    query
      ? getDb().query(
          `SELECT v.id, v.name, v.source_name, v.category, v.subcategory, v.subcategory_id,
             v.unit_price_cents, v.is_visible, v.hidden, v.hidden_until
           FROM catalog.product_view v
           WHERE v.deleted_at IS NULL AND (v.id = $1 OR v.upc = $1 OR v.name ILIKE '%' || $1 || '%')
           ORDER BY v.name LIMIT 20`,
          [query],
        )
      : null,
  ])
  const unmapped = mappings.filter((m) => m.status === 'unmapped')
  return (
    <div>
      <PageTitle>Catalogue</PageTitle>
      <Section
        title="Ingest runs"
        actions={<RequestRun merchants={merchants.map((m) => ({ id: m.id, name: m.name }))} />}
      >
        <Table
          head={[
            'Run',
            'Merchant',
            'Mode',
            'Status',
            'Fetched',
            'Ins / upd / same / deact',
            'Quarantined',
            'Anomalies / error',
            'Started',
            '',
          ]}
          rows={runs.map((r) => [
            `#${r.id}`,
            r.merchant,
            r.mode,
            <Badge key="s" value={r.status} />,
            r.fetched,
            `${r.inserted} / ${r.updated} / ${r.unchanged} / ${r.deactivated}`,
            r.quarantined,
            r.error ?? r.anomalies.map((a) => String(a.check)).join(', '),
            when(r.startedAt),
            r.status === 'held' ? (
              r.pendingRequest ? (
                <span key="p" className="text-xs">
                  approval requested
                </span>
              ) : (
                <span key="d" className="flex gap-2">
                  <ActionButton
                    path={`catalog/ingest-runs/${r.id}/decision`}
                    body={{ decision: 'approve' }}
                    confirm="Apply this held feed as it is?"
                    done="Approval requested"
                  >
                    Approve
                  </ActionButton>
                  <ActionButton
                    path={`catalog/ingest-runs/${r.id}/decision`}
                    body={{ decision: 'reject' }}
                    variant="secondary"
                  >
                    Reject
                  </ActionButton>
                </span>
              )
            ) : null,
          ])}
        />
        <h3 className="mb-2 mt-6 font-semibold">Requests to the pipeline</h3>
        <Table
          head={['Request', 'Merchant', 'Kind', 'Status', 'By', 'Error', 'Created', 'Processed']}
          empty="No requests."
          rows={requests.map((r) => [
            `#${r.id}`,
            r.merchant,
            r.kind === 'approve' ? `approve run #${r.runId}` : `${r.mode} run`,
            <Badge key="s" value={r.status} />,
            r.requestedBy,
            r.error ?? '',
            when(r.createdAt),
            when(r.processedAt),
          ])}
        />
      </Section>

      <Section
        title={`Category mappings${unmapped.length ? ` (${unmapped.length} unmapped)` : ''}`}
      >
        <Table
          head={['Merchant', 'Source category', 'Status', 'Ours']}
          rows={mappings.map((m) => [
            m.merchant,
            `${m.sourceType}${m.sourceSubtype ? ` › ${m.sourceSubtype}` : ''}`,
            <Badge key="s" value={m.status} />,
            <MappingSelect
              key="m"
              mappingId={m.id}
              current={m.subcategoryId}
              subcategories={subcategories}
            />,
          ])}
        />
      </Section>

      <Section title="Product overrides">
        <form className="mb-4 flex gap-2 text-sm" role="search">
          <input
            name="q"
            defaultValue={query ?? ''}
            placeholder="Product id, name or UPC"
            className="rounded border px-2 py-1"
          />
          <button className="rounded bg-[#1F3A2E] px-3 py-1.5 text-white">Find</button>
        </form>
        {products && (
          <Table
            head={['Product', 'Category', 'Price', 'Visible', 'Override']}
            empty="No products match."
            rows={products.rows.map((p) => [
              <span key="n">
                {p.name}
                {p.name !== p.source_name && (
                  <span className="text-xs text-neutral-600"> (source: {p.source_name})</span>
                )}
                <br />
                <span className="font-mono text-xs">{p.id}</span>
              </span>,
              `${p.category} › ${p.subcategory}`,
              cad(p.unit_price_cents),
              p.is_visible ? 'Yes' : p.hidden_until ? `hidden until ${when(p.hidden_until)}` : 'No',
              <OverrideForm
                key="o"
                productId={p.id}
                hidden={p.hidden}
                subcategoryId={p.subcategory_id === null ? null : Number(p.subcategory_id)}
                subcategories={subcategories}
              />,
            ])}
          />
        )}
      </Section>
    </div>
  )
}
