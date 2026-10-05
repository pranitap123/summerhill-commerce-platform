# RB-11 Search index rebuild

When: search results are stale or wrong, the mapping or synonyms changed, Elasticsearch lost its data, or after [RB-14](RB-14-restore-database.md).

## Customers are safe meanwhile

If Elasticsearch is down or slow, search falls back to Postgres full-text search at once (a circuit breaker per dependency, `src/server/outbound.ts`). Results are plainer but correct. Postgres is the system of record (ADR-0004), so the index can always be rebuilt from it.

## Rebuild

```bash
app: npm run search:rebuild
# search: indexed 219 products into catalog-products-… (alias swapped; …)
```

Or from `/ops/catalog` (`POST /api/admin/search/rebuild`), which queues the `search.rebuild` job. The worker also rebuilds nightly.

A rebuild creates a new index `catalog-products-<timestamp>`, fills it from Postgres, verifies the count, catches up changes made during the build, then swaps the alias `catalog-products` in one step. The previous index is kept for rollback; older ones are removed. Search never sees a half-built index; a failed rebuild leaves the old one serving.

**Roll back** (the new index is wrong): point the alias at the previous index.

```bash
curl -s 'localhost:9200/_cat/indices/catalog-products-*?h=index,docs.count'
curl -s -XPOST localhost:9200/_aliases -H 'content-type: application/json' -d '{"actions":[
  {"remove":{"index":"catalog-products-<new>","alias":"catalog-products"}},
  {"add":{"index":"catalog-products-<previous>","alias":"catalog-products"}}]}'
```

## Elasticsearch itself is broken

```bash
docker restart grocery-elasticsearch        # local stack
curl -s localhost:9200/_cluster/health       # wait for yellow/green
app: npm run search:rebuild
```

## Verify

`curl -s localhost:9200/_cat/aliases/catalog-products` points to the new index; a search on the storefront returns results; `/ops/catalog` search report shows no errors.

Walked through 2026-09-29 on the local stack: `npm run search:rebuild` indexed 219 products into a new index and moved the alias; the previous index stayed for rollback, the one before it was removed.
