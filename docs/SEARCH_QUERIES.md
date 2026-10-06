# Elasticsearch: index and sample queries

The storefront search runs against the alias `catalog-products` (`SEARCH_INDEX_ALIAS`). Each rebuild
creates `catalog-products-<timestamp>`, verifies the document count, then swaps the alias, so a
half-built index is never served. The code is
[`elastic.ts`](../web/summerhill-commerce/src/modules/search/elastic.ts); the design is in
[CATALOG_AND_SEARCH §8](domains/CATALOG_AND_SEARCH.md#8-search) and [ADR-0007](adr/0007-search-engine.md).

Build the index with `npm run search:rebuild --prefix web/summerhill-commerce` (the full Docker stack does
it for you). The examples use Elasticsearch on `localhost:9200`.

## Design in short

| Concern | How |
|---|---|
| Text relevance | `multi_match` over `name^4, brand^2, subcategory^2, category, description^0.3` |
| Typos | `fuzziness: AUTO`, first letter must match (`prefix_length: 1`) |
| Search-as-you-type | `bool_prefix` over `name.prefix` and `brand.prefix` (edge n-grams, 2 to 15) |
| Synonyms | `synonym_graph` in the search analyzer only (pop/soda, courgette/zucchini, ...) |
| Stemming | light English stemmer, possessives removed |
| Boosts | exact name ×12, on sale ×1.2, in stock ×1.1, `log2p(popularity30d)` |
| Filters | listed, not hidden, merchant, organic, on sale, in stock, dietary claims, price range |
| Facets | categories, subcategories, organic and on-sale counts, dietary claims, price range |
| Fallback | if Elasticsearch is down or its circuit is open, search uses Postgres full-text and `pg_trgm` |

Engines return ranked ids only. Products are always read from Postgres, so prices and stock are never
stale in a result.

## Examples

Free text with typo tolerance and prefix matching ("milc" finds milk):

```bash
curl -s localhost:9200/catalog-products/_search -H 'content-type: application/json' -d '{
  "size": 5,
  "_source": ["name", "brand", "effectivePriceCents"],
  "query": {
    "bool": {
      "filter": [{ "term": { "listed": true } }],
      "must": [{
        "bool": {
          "should": [
            { "multi_match": { "query": "milc", "fields": ["name^4","brand^2","subcategory^2","category"],
                               "type": "most_fields", "operator": "and", "fuzziness": "AUTO",
                               "prefix_length": 1, "analyzer": "en_index" } },
            { "multi_match": { "query": "milc", "type": "bool_prefix", "fields": ["name.prefix^3","brand.prefix^1.5"],
                               "operator": "and" } }
          ],
          "minimum_should_match": 1
        }
      }]
    }
  }
}'
```

Synonyms ("pop" matches soda):

```bash
curl -s 'localhost:9200/catalog-products/_search?size=5&_source=name' -H 'content-type: application/json' -d '{
  "query": { "match": { "name": { "query": "pop", "analyzer": "en_search" } } }
}'
```

Browse a category, organic only, under $5, cheapest first, with facet counts:

```bash
curl -s localhost:9200/catalog-products/_search -H 'content-type: application/json' -d '{
  "size": 10,
  "_source": ["name", "effectivePriceCents"],
  "query": { "bool": { "filter": [
    { "term": { "listed": true } },
    { "term": { "categorySlug": "produce" } },
    { "term": { "organic": true } },
    { "range": { "effectivePriceCents": { "lte": 500 } } }
  ] } },
  "sort": [{ "effectivePriceCents": "asc" }, { "name.exact": "asc" }],
  "aggs": {
    "subcategories": { "terms": { "field": "subcategorySlug", "size": 20 } },
    "price": { "stats": { "field": "effectivePriceCents" } }
  }
}'
```

Check what is behind the alias, and the document count:

```bash
curl -s 'localhost:9200/_alias/catalog-products?pretty'
curl -s 'localhost:9200/catalog-products/_count?pretty'
```

Look at how a query is analysed (stemming and synonyms):

```bash
curl -s localhost:9200/catalog-products/_analyze -H 'content-type: application/json' \
  -d '{ "analyzer": "en_search", "text": "courgettes" }'
```

The exact request the app builds, with every filter and the facet aggregations, is
`buildSearchRequest` in `elastic.ts`.
