#!/usr/bin/env node
// Stage 1 scraper: fetches the product list from the storefront's JSON API and writes it grouped by
// category and subcategory.
//
//   node scripts/scraper.js [--out path/to/scraped.json]
//
// Configuration comes from the environment (a .env file in the working directory is read too);
// see .env.example at the repo root. The full re-run instructions and assumptions are in
// docs/SCRAPER.md.
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REQUIRED = ['API_KEY', 'LOCATION_ID', 'PRICELIST_ID', 'BASE_URL', 'IMAGE_BASE'];

function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')} (see .env.example)`);
  }
  const outFlag = argv.indexOf('--out');
  return {
    apiKey: env.API_KEY,
    locationId: env.LOCATION_ID,
    pricelistId: env.PRICELIST_ID,
    baseUrl: env.BASE_URL.replace(/\/+$/, ''),
    imageBase: env.IMAGE_BASE.replace(/\/+$/, ''),
    currency: env.CURRENCY || 'CAD',
    out: path.resolve(outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : env.OUTPUT_PATH || 'scraped.json'),
    // Identify the scraper honestly. ORIGIN and REFERER are only sent when you set them.
    userAgent: env.USER_AGENT || 'summerhill-scraper/1.0 (catalogue demo; respectful rate)',
    origin: env.ORIGIN || '',
    referer: env.REFERER || '',
    maxRetries: Number(env.MAX_RETRIES ?? 4),
    baseDelayMs: Number(env.RETRY_BASE_DELAY_MS ?? 1000),
    timeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 30000),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failure worth retrying: no response (network, timeout), 408, 429 or any 5xx. */
function isRetryable(err) {
  const status = err.response?.status;
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Retry-After in seconds or as an HTTP date, in milliseconds; null if absent or unreadable. */
function retryAfterMs(err) {
  const raw = err.response?.headers?.['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Calls `fn`, retrying retryable failures with exponential backoff, jitter and Retry-After. */
async function withRetry(fn, { maxRetries, baseDelayMs, log = console.warn, wait = sleep }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      const backoff = baseDelayMs * 2 ** attempt;
      const delay = Math.min(60000, Math.max(retryAfterMs(err) ?? 0, backoff + Math.random() * baseDelayMs));
      log(`Attempt ${attempt + 1} failed (${err.response?.status || err.code || err.message}); retrying in ${Math.round(delay)} ms`);
      await wait(delay);
    }
  }
}

async function fetchProducts(config, http = axios) {
  const headers = {
    apikey: config.apiKey,
    location: config.locationId,
    pricelist: config.pricelistId,
    'user-agent': config.userAgent,
  };
  if (config.origin) headers.origin = config.origin;
  if (config.referer) headers.referer = config.referer;
  const response = await withRetry(
    () => http.get(`${config.baseUrl}/product/list?listType=ui`, { headers, timeout: config.timeoutMs }),
    config,
  );
  const products = response.data?.products;
  if (!Array.isArray(products)) throw new Error('Unexpected response: no "products" array');
  return products;
}

/**
 * The API has no description field, so one is built from what it does give us: brand, organic flag,
 * how the item is sold and its disclaimer. Empty when the API gives none of these.
 */
function describe(p) {
  const parts = [];
  if (p.brand) parts.push(p.brand);
  if (p.organic) parts.push('Organic');
  if (p.unit) parts.push(`Sold by ${p.unit}`);
  if (p.disclaimer) parts.push(String(p.disclaimer).trim());
  return parts.join('. ');
}

function transformProduct(p, config) {
  const imageKey = p.mainImage || p.name;
  return {
    id: p.name,
    name: p.displayName,
    description: describe(p),
    price: p.price,
    currency: config.currency,
    sku: p.upc,
    images: [`${config.imageBase}/${imageKey}.jpg`],
    category: p.type,
    subcategory: p.subType,
    availability: p.isInStock ? 'in_stock' : 'out_of_stock',
  };
}

/** Groups products into [{ category, subcategory, products }], in first-seen order. */
function group(products, config) {
  const groups = new Map();
  for (const p of products) {
    const key = JSON.stringify([p.type, p.subType]);
    if (!groups.has(key)) groups.set(key, { category: p.type, subcategory: p.subType, products: [] });
    groups.get(key).products.push(transformProduct(p, config));
  }
  return [...groups.values()];
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log('Fetching products from', config.baseUrl);
  let products;
  try {
    products = await fetchProducts(config);
  } catch (err) {
    console.error('Fetch failed:', err.response?.status || err.code, err.message);
    process.exit(1);
  }
  console.log(`Fetched ${products.length} products`);
  const output = group(products, config);
  writeAtomic(config.out, JSON.stringify(output, null, 2));
  console.log(`Wrote ${output.length} category groups (${products.length} products) to ${config.out}`);
}

if (require.main === module) {
  require('dotenv').config();
  main();
}

module.exports = { loadConfig, withRetry, isRetryable, retryAfterMs, fetchProducts, describe, transformProduct, group };
