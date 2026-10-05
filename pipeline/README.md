# Catalogue pipeline

Python package `catalog_pipeline`: the single writer of the catalogue (`catalog.*` tables), running as the least-privilege `ingest_rw` role. Design: [CATALOG_AND_SEARCH](../docs/domains/CATALOG_AND_SEARCH.md) §2–§7.

```
extract → normalise → quality rules ──bad rows──> ops.ingest_quarantine
                           │
                  map categories (catalog.category_mappings; unknown → Uncategorised + flag)
                           │
          diff by external_id + source_hash (unchanged = no write)
                           │
                    anomaly guard ──suspicious──> run HELD (nothing applied, feed staged)
                           │
      one transaction: upserts, soft deletes (full runs), promotions, slug history,
                       outbox product.changed / catalog.ingested
```

The web app's worker consumes the outbox: it updates Elasticsearch and revalidates storefront pages. The pipeline never talks to Elasticsearch.

## Setup and commands (from the repo root)

```bash
npm run pipeline:install          # .venv + pinned requirements.txt (Python 3.12+)
npm run pipeline:test             # pytest; DB tests need `npm run stack:up`
node tools/pipeline.mjs test:unit    # unit tests only, no database
npm run pipeline:ingest           # one full run with the fixture connector
npm run pipeline:ingest -- --mode delta
npm run pipeline:runs             # recent runs with their counts and anomalies
node tools/pipeline.mjs approve <run id> --by <name>   # apply a held run's staged feed
node tools/pipeline.mjs reject <run id> --by <name>
npm run pipeline:requests         # carry out approvals and re-runs asked for in /ops/catalog (G5-14)
npm run pipeline:dagster          # Dagster UI at http://localhost:3070
```

Configuration comes from the environment only (`infra/local.env` for the root scripts):

| Variable | Default | Meaning |
|---|---|---|
| `INGEST_DATABASE_URL` | (required) | Postgres URL of the `ingest_rw` role |
| `CATALOG_CONNECTOR` | `fixture` | `fixture` or `homesome_api` |
| `CATALOG_MERCHANT_SLUG` / `CATALOG_LOCATION_SLUG` | `demo-market` / `downtown` | whose catalogue the run loads |
| `CATALOG_FIXTURE_PATH` | `db/seed/catalog.fixture.json` | feed for the fixture connector |
| `CATALOG_FIXTURE_FRACTION` | (all) | demo/test knob: only the first part of the fixture feed, e.g. `0.5`, to show the anomaly guard holding a run |

## Schedules (Dagster)

| Schedule | Cron (America/Toronto) | Job |
|---|---|---|
| `catalog_delta_store_hours` | `*/15 7-21 * * *` | delta: prices, promotions, availability; never deactivates |
| `catalog_full_nightly` | `0 3 * * *` | full: all fields; soft-deletes products missing from the feed |

Schedules only fire while the Dagster daemon runs (`npm run pipeline:dagster` starts it with the UI). A held run doesn't fail the Dagster job: the guard did its job, and the log names the approve command.

**Requests from /ops (G5-14).** The web app can't write the catalogue (ADR-0004). Approving a held run, asking for a run or changing a category mapping in `/ops/catalog` inserts a row in `ops.ingest_requests`; the `admin_requests_sensor` (every 30 s) starts the `catalog_admin_requests` job, which claims pending requests with `SKIP LOCKED` and carries them out as `ingest_rw`. Without Dagster, `npm run pipeline:requests` does the same once. Rejecting a held run is a status change, which the app does directly.

## Connectors

| Connector | Default | Notes |
|---|---|---|
| `fixture` | ✅ | Deterministic synthetic feed from `db/seed/generate.mjs`. No network calls. Product ids = `external_id` (`DEMO-0001`). |
| `homesome_api` | opt-in | A merchant's store API. **Use it only with the data owner's written permission and your own credentials.** Disabled unless `HOMESOME_ENABLED=true` and `HOMESOME_BASE_URL`, `HOMESOME_API_KEY`, `HOMESOME_LOCATION_ID`, `HOMESOME_PRICELIST_ID` are set. It identifies itself honestly (no browser user agent, no spoofed Origin/Referer), uses 5 s/30 s timeouts and bounded retries that respect `Retry-After`. Product ids are prefixed `hs-`. Optional: `HOMESOME_IMAGE_BASE`, `HOMESOME_PROMOTIONS_PATH`, `HOMESOME_CONTACT`. |

**Never commit real merchant data.** Feeds, API responses and dumps are git-ignored (`scraped.json`, `*_sample.json`, `/data/`), and `tools/scan-secrets.mjs` blocks them in the pre-commit hook.

A new connector implements `SourceConnector` ([connectors/base.py](catalog_pipeline/connectors/base.py)): `extract(mode)`, `normalise(raw) → CanonicalProduct` (raise `QualityError` to quarantine), `default_mappings()`, and optionally `post_process(products)` (e.g. promotions keyed by UPC).

## Data-quality rules and the anomaly guard

Quarantined (row skipped, recorded in `ops.ingest_quarantine`): missing id/name/price, price ≤ 0 or > $2,000, more than 2 decimals, unknown unit or tax rate, bad weekday, duplicate id in the feed, sale price not below the regular price.

Flagged (applied, listed in `ops.ingest_runs.flags`): price change > ±60%, unmapped category, missing image (placeholder used), alcohol (ingested with `blocked_reason = 'alcohol_not_licensed'`, never sold), promotion UPC matching several products or none.

Held for approval (nothing applied): fetched < 90% of the last successful run of the same mode; > 10% of active products would be deactivated (full runs); > 25% of prices changed; quarantined > 5% of the feed.
