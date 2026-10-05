# RB-10 Ingest anomaly held

Alert: `ingest.held` (SEV3): the catalogue pipeline's anomaly guard held an ingest run (the feed looked wrong: many products disappeared, prices moved too much, too many rows failed quality rules). **Nothing was applied**: the storefront keeps the last good catalogue, and the feed is staged for review.

## 1. Look at the run

```bash
npm run pipeline:runs                 # latest runs; held ones show why
```

Or `/ops/catalog` → held runs, with the guard's findings (counts before/after, the biggest changes).

## 2. Decide

| The change is… | Do |
|---|---|
| Real (the merchant really delisted a department, a price update) | **Approve** |
| A broken feed (half the file, a currency or unit change, a scraper failure) | **Reject**, and fix the source; the next scheduled run tries again |

```bash
node tools/pipeline.mjs approve <run id> --by "your name"   # applies the staged feed
node tools/pipeline.mjs reject <run id> --by "your name"
```

Approving in `/ops/catalog` works too. The web app can't write the catalogue (ADR-0004), so it files a request that the pipeline carries out: the Dagster sensor within 30 s, or `npm run pipeline:requests` without Dagster.

## 3. Verify

`npm run pipeline:runs` shows the run applied (or rejected). After an approval the search index follows through `product.changed` events; the storefront pages revalidate. Resolve the alert.

Walked through 2026-09-29 on the local stack: `CATALOG_FIXTURE_FRACTION=0.5 npm run pipeline:ingest` → run held; `pipeline:runs` shows it; rejected with `tools/pipeline.mjs reject`; the next full ingest applied cleanly.
