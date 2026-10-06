// Unit tests for scripts/scraper.js. Run with: npm run test:scraper
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, withRetry, isRetryable, retryAfterMs, fetchProducts, describe, group } = require('../scripts/scraper');

const ENV = { API_KEY: 'k', LOCATION_ID: 'l', PRICELIST_ID: 'p', BASE_URL: 'https://api.example.test/', IMAGE_BASE: 'https://img.example.test/' };
const config = { ...loadConfig(ENV, []), baseDelayMs: 0, maxRetries: 3 };
const httpError = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });

test('loadConfig lists every missing variable', () => {
  assert.throws(() => loadConfig({ API_KEY: 'k' }, []), /LOCATION_ID, PRICELIST_ID, BASE_URL, IMAGE_BASE/);
});

test('loadConfig applies defaults, trims slashes and honours --out', () => {
  assert.equal(config.baseUrl, 'https://api.example.test');
  assert.equal(config.currency, 'CAD');
  assert.match(config.out, /scraped\.json$/);
  assert.match(loadConfig(ENV, ['--out', 'x/y.json']).out, /x(\\|\/)y\.json$/);
  assert.equal(loadConfig(ENV, []).origin, '');
});

test('isRetryable: network errors, 408, 429 and 5xx retry; other 4xx do not', () => {
  assert.equal(isRetryable(new Error('ECONNRESET')), true);
  for (const s of [408, 429, 500, 503]) assert.equal(isRetryable(httpError(s)), true);
  for (const s of [400, 401, 403, 404]) assert.equal(isRetryable(httpError(s)), false);
});

test('retryAfterMs reads seconds and HTTP dates', () => {
  assert.equal(retryAfterMs(httpError(429, { 'retry-after': '7' })), 7000);
  assert.ok(retryAfterMs(httpError(429, { 'retry-after': new Date(Date.now() + 5000).toUTCString() })) > 0);
  assert.equal(retryAfterMs(httpError(429)), null);
});

test('withRetry retries transient failures then succeeds', async () => {
  let calls = 0;
  const waits = [];
  const result = await withRetry(
    async () => {
      if (++calls < 3) throw httpError(503);
      return 'ok';
    },
    { ...config, log: () => {}, wait: async (ms) => waits.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
});

test('withRetry gives up after maxRetries and does not retry a 401', async () => {
  let calls = 0;
  const opts = { ...config, log: () => {}, wait: async () => {} };
  await assert.rejects(withRetry(async () => { calls++; throw httpError(500); }, opts), /HTTP 500/);
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw httpError(401); }, opts), /HTTP 401/);
  assert.equal(calls, 1);
});

test('fetchProducts sends the key and location, no spoofed origin, and validates the body', async () => {
  let seen;
  const http = { get: async (url, opts) => ((seen = { url, opts }), { data: { products: [{ name: 'a' }] } }) };
  assert.deepEqual(await fetchProducts(config, http), [{ name: 'a' }]);
  assert.equal(seen.url, 'https://api.example.test/product/list?listType=ui');
  assert.equal(seen.opts.headers.apikey, 'k');
  assert.equal(seen.opts.headers.origin, undefined);
  assert.match(seen.opts.headers['user-agent'], /^summerhill-scraper/);
  await assert.rejects(fetchProducts(config, { get: async () => ({ data: {} }) }), /no "products" array/);
});

test('describe builds a description from brand, organic, unit and disclaimer', () => {
  assert.equal(describe({ brand: 'Acme', organic: true, unit: 'count', disclaimer: ' Contains nuts ' }), 'Acme. Organic. Sold by count. Contains nuts');
  assert.equal(describe({}), '');
});

test('group keeps the output shape: one entry per category and subcategory', () => {
  const raw = [
    { name: '1', displayName: 'A', type: 'Dairy', subType: 'Eggs', price: 1, upc: '1', isInStock: true, mainImage: 'img-1' },
    { name: '2', displayName: 'B', type: 'Dairy', subType: 'Milk', price: 2, upc: '2', isInStock: false },
    { name: '3', displayName: 'C', type: 'Dairy', subType: 'Eggs', price: 3, upc: '3', isInStock: true },
  ];
  const out = group(raw, config);
  assert.deepEqual(out.map((g) => [g.category, g.subcategory, g.products.length]), [['Dairy', 'Eggs', 2], ['Dairy', 'Milk', 1]]);
  assert.deepEqual(out[0].products[0], {
    id: '1', name: 'A', description: '', price: 1, currency: 'CAD', sku: '1',
    images: ['https://img.example.test/img-1.jpg'], category: 'Dairy', subcategory: 'Eggs', availability: 'in_stock',
  });
  assert.equal(out[1].products[0].availability, 'out_of_stock');
  assert.equal(out[1].products[0].images[0], 'https://img.example.test/2.jpg');
});
