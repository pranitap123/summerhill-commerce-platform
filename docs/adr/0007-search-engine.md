# ADR-0007: Search engine

- Status: **Accepted**: Elasticsearch for text search, Postgres for browsing and as the fallback (G3-08)
- Date: 2026-09-27 (proposed), 2026-09-28 (accepted)

## Context
~3,150 products now; a realistic horizon of ~50k with 10+ merchants. The requirements are typo tolerance, prefix search, synonyms, facets, and p95 < 300 ms. Elasticsearch is already set up (stage 2 of the project) but is minimally configured, and it adds cost (managed ≈ CA$130+/month) plus operational work (index management, version upgrades).

## Options
1. **Postgres full-text search + `pg_trgm`** (weighted `tsvector`, English config, trigram similarity for typos, synonym dictionary): no extra infrastructure, transactional consistency, easily meets the latency target at this size.
2. **Elasticsearch/OpenSearch** (keep and improve): best relevance tooling; extra cost and operations.
3. **Hosted search (Typesense Cloud / Algolia / Meilisearch)**: excellent typo tolerance and relevance out of the box; per-record/per-search pricing; another vendor.

## Recommendation
Put the engine behind a `SearchService` interface. **If the brief mandates Elasticsearch, keep ES** with the v2 mapping, bulk indexing and alias swaps (see [CATALOG §8](../domains/CATALOG_AND_SEARCH.md#8-search)). **Otherwise use Postgres FTS for the pilot** and revisit at 50k products or when relevance needs merchandising features.

## Consequences
Either way: the projection is rebuildable, there's a fallback path (Postgres) when the external engine is down, and search analytics drive the synonyms.

## Decision (G3-08)
Elasticsearch stays, because it's already part of the project and the brief treats it as part of the stack. The engine sits behind one `SearchService` (`findProducts` in `src/modules/search`):

- **Text search → Elasticsearch.** English analyzer with light stemming; synonyms applied at search time (`synonym_graph`, list versioned in `src/modules/search/synonyms.ts`); edge n-grams for prefixes; fuzziness AUTO (analysed without synonyms, since Lucene can't fuzz a synonym graph); boosts: exact name ×3, on sale ×1.2, in stock ×1.1, popularity (log).
- **Browsing (no text) → Postgres**, the source of truth, so a stale or missing index can never hide products. The same code is the **fallback** when Elasticsearch fails: `pg_trgm` word similarity (≥ 0.55) for typos, `term:*` full-text queries for prefixes, word-level synonym expansion. The response says which engine answered (`engine`).
- **Ids only from the engines; products are always hydrated from Postgres**, so prices shown are never the index's copy, and anything hidden since the last sync is filtered out.
- **Index lifecycle:** queries go through an alias (`SEARCH_INDEX_ALIAS`, default `catalog-products`). The nightly `search.rebuild` job builds `<alias>-<timestamp>`, verifies the document count, swaps the alias atomically, re-applies products changed during the build, and keeps one previous index for rollback. `product.changed` outbox events upsert single documents within seconds (`search.upsertProduct`, `refresh=wait_for`).
- **Measured locally:** p95 < 300 ms for search and browse (integration test, 80 requests).

Consequences: two engines to keep consistent. The integration tests assert that both return the same facet counts and satisfy the same relevance cases (typos, prefixes, synonyms, stemming).
