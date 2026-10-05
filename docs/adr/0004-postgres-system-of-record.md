# ADR-0004: Postgres as the system of record; ingest-owned catalogue with an override layer

- Status: Accepted, implemented (G1-03, G1-18, G3). Amended in the build: Payload keeps its own database (`payload`) instead of a schema, and there is no `pgboss` schema because jobs run on `ops.jobs` ([ADR-0008](0008-background-jobs-and-outbox.md))
- Date: 2026-09-27

## Context
Today the catalogue lives in a standalone Postgres database (`summerhill`) accessed with hardcoded credentials, while Payload uses another database. Elasticsearch holds a partial copy. Products were also modelled in Payload's `Products` collection.

## Decision
- A single Postgres cluster with schemas per module (`catalog`, `merchant`, `commerce`, `finance`, `ops`, `payload`, `pgboss`) and DB roles per workload.
- Catalogue rows are owned by the ingest pipeline (per-merchant connectors). Human edits go to `catalog.product_overrides`, which ingest never modifies. Reads use `COALESCE(override, source)`.
- The search index is a rebuildable projection.
- Payload's `Products` collection is removed.

## Update (2026-09-27, G1): Payload in its own database
Implementing G1 showed that Payload's `schemaName` option (to keep Payload in a `payload` schema) is marked **experimental** in `@payloadcms/db-postgres` and fails when the same table name exists in another schema. Payload's `categories` collection would clash with `catalog.categories`.

**Changed decision:** one Postgres **server**, two databases:
- `grocery`: marketplace schemas `catalog`, `merchant`, `commerce`, `finance`, `ops`, managed by `db/migrations`
- `payload`: Payload CMS (users, pages, media), owned by `app_rw` so Payload can manage its own tables; other roles can't connect

The app uses `CATALOG_DATABASE_URL` for the marketplace and `DATABASE_URL` for Payload. Cross-database joins between Payload users and orders are not possible; orders reference users by id, and the few places that need user details call Payload's API. Revisit if Payload's schema support leaves experimental.

## Consequences
- \+ Transactions across orders and ledger; one backup/restore story.
- \+ Merchant/admin edits survive every re-ingest.
- − Payload admin can't edit products; product management lives in our `/ops` console.
