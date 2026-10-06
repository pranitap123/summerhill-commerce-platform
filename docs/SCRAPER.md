# Stage 1: product scraper

[`scripts/scraper.js`](../scripts/scraper.js) fetches a storefront's product list from its JSON API and
writes it grouped by category and subcategory.

## Run it

```bash
cp .env.example .env     # then fill in API_KEY, LOCATION_ID, PRICELIST_ID, BASE_URL, IMAGE_BASE
npm install
node scripts/scraper.js                      # writes ./scraped.json
node scripts/scraper.js --out data/run1.json # or choose the path (also OUTPUT_PATH)
```

Feed it to the pipeline (Postgres, then Elasticsearch) with the `scraped_json` connector:

```bash
CATALOG_CONNECTOR=scraped_json SCRAPED_JSON_PATH=scraped.json npm run pipeline:ingest   # or run it from Dagster
```

Re-running is safe: it overwrites the output file (written to a temp file, then renamed, so a failed
run never leaves a half-written file). Tests: `npm run test:scraper`.

## Output

An array with one entry per category and subcategory. A sample is in
[`docs/samples/scraped.sample.json`](samples/scraped.sample.json) (synthetic).

```json
[
  {
    "category": "Dairy & Eggs",
    "subcategory": "Eggs",
    "products": [
      {
        "id": "000000000011", "name": "Free-Range Eggs Large 12 Count",
        "description": "Example Farm. Sold by count", "price": 5.49, "currency": "CAD",
        "sku": "000000000011", "images": ["https://images.example.test/products/000000000011.jpg"],
        "category": "Dairy & Eggs", "subcategory": "Eggs", "availability": "in_stock"
      }
    ]
  }
]
```

## Behaviour

- **Retries:** network errors, timeouts, 408, 429 and 5xx are retried with exponential backoff and jitter
  (`MAX_RETRIES`, default 4; base delay `RETRY_BASE_DELAY_MS`, default 1 s). A `Retry-After` header is
  honoured. Other 4xx responses (bad key, wrong location) fail at once.
- **Headers:** the scraper sends its own `User-Agent` (`USER_AGENT` to override) and does not send
  `Origin` or `Referer` unless you set `ORIGIN` / `REFERER`.
- **Validation:** missing configuration lists every missing variable; a response without a `products`
  array is an error rather than an empty file.

## Assumptions

- The API returns every product in one response, so there is no pagination.
- `id` is the API's `name` field and `sku` is its `upc`.
- The API has no description field. `description` is built from `brand`, `organic`, `unit` and
  `disclaimer`, and is empty when none are present. Nothing is invented beyond those fields.
- Image URLs are `IMAGE_BASE/<mainImage>.jpg`, falling back to the product `name` when there is no
  `mainImage`.
- `availability` is `in_stock` or `out_of_stock` from `isInStock`. Prices are the API's number as is;
  `CURRENCY` (default `CAD`) is applied to every product.
- Scraped data is not committed (`scraped.json` is git-ignored): it is a merchant's real catalogue.
  The repo ships a synthetic catalogue for the demo; see [`docs/domains/CATALOG_AND_SEARCH.md`](domains/CATALOG_AND_SEARCH.md).
- Scrape only sites whose terms allow it, at a modest rate. The scraper makes one request per run.
