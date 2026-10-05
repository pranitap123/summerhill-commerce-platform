#!/usr/bin/env node
// Deterministic synthetic catalogue for demos and tests. No real merchant data.
//
//   node db/seed/generate.mjs            writes db/seed/catalog.fixture.json
//
// The output follows the canonical product model (docs/domains/CATALOG_AND_SEARCH.md §3) so the
// G3 fixture connector can ingest it unchanged. The generator asserts that every rule the system
// must handle is represented (pricing models, tax codes, promotions, deposits, availability days,
// quantity limits, dietary claims), so demos and tests can't silently lose coverage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'catalog.fixture.json');
// One public-domain/CC0 photo per base item (credits: web/summerhill-commerce/public/product-images/CREDITS.md)
const IMAGES = JSON.parse(fs.readFileSync(path.join(DIR, 'product-images.json'), 'utf8'));
const PLACEHOLDER_IMAGE = '/placeholder-product.svg';
const SEED = 20260927;

// mulberry32: small, fast, deterministic PRNG
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const cents = (min, max) => Math.round((min + rand() * (max - min)) * 100 / 10) * 10 - 1; // e.g. 4.99

const BRANDS = ['Maple Row', 'Harbour Kitchen', 'Northfield', 'Cedar & Salt', 'Lakeside Farms', 'Old Mill', 'Green Acre', 'Juniper Lane'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// taxable: true → HST_STANDARD (13%); false → ZERO_RATED (basic groceries)
const TAXONOMY = [
  { category: 'Produce', subs: {
      'Fresh Fruit': { taxable: false, weighed: 0.6, items: ['Honeycrisp Apples', 'Bananas', 'Bartlett Pears', 'Seedless Green Grapes', 'Navel Oranges', 'Mangoes', 'Lemons'] },
      'Fresh Vegetables': { taxable: false, weighed: 0.6, items: ['Broccoli Crowns', 'Carrots', 'Yellow Onions', 'Gold Potatoes', 'Red Peppers', 'English Cucumber', 'Zucchini'] },
  } },
  { category: 'Meat & Seafood', subs: {
      'Beef': { taxable: false, weighed: 0.9, items: ['Rib Steak', 'Striploin Steak', 'Lean Ground Beef', 'Beef Short Ribs'] },
      'Seafood': { taxable: false, weighed: 0.9, items: ['Atlantic Salmon Fillet', 'Wild Shrimp', 'Cod Loin', 'Rainbow Trout'] },
  } },
  { category: 'Dairy & Eggs', subs: {
      'Eggs': { taxable: false, items: ['Free Run Eggs 12 ea', 'Omega-3 Eggs 12 ea', 'Large Brown Eggs 18 ea'] },
      'Cheese': { taxable: false, weighed: 0.3, items: ['Aged Cheddar', 'Brie', 'Gouda', 'Parmigiano'] },
      'Milk & Cream': { taxable: false, items: ['2% Milk 2 L', 'Whole Milk 1 L', 'Table Cream 473 ml', 'Oat Beverage 1.75 L'] },
  } },
  { category: 'Bakery', subs: {
      'Breads': { taxable: false, items: ['Sourdough Loaf', 'Multigrain Loaf', 'Baguette', 'Rye Bread'] },
      'Cakes & Pastries': { taxable: true, items: ['Butter Croissants 4 ea', 'Carrot Cake Slice', 'Lemon Tart', 'Chocolate Brownies 6 ea'] },
  } },
  { category: 'Prepared Meals', subs: {
      'Entrees': { taxable: true, days: true, items: ['Chicken Pot Pie', 'Beef Lasagna', 'Butter Chicken', 'Vegetable Curry', 'Salmon Teriyaki Bowl'] },
      'Sushi': { taxable: true, days: true, items: ['California Roll 8 pc', 'Salmon Avocado Roll 8 pc', 'Vegetable Roll 8 pc'] },
  } },
  { category: 'Beverages', subs: {
      'Juice': { taxable: false, items: ['Orange Juice 1.5 L', 'Apple Juice 1 L', 'Cold-Pressed Green Juice 350 ml'] },
      'Soft Drinks': { taxable: true, deposit: true, items: ['Sparkling Water 500 ml', 'Ginger Ale 355 ml', 'Cola 2 L', 'Lemon Soda 355 ml'] },
  } },
  { category: 'Snacks & Treats', subs: {
      'Chips': { taxable: true, items: ['Sea Salt Kettle Chips 200 g', 'Tortilla Chips 300 g', 'Salt & Vinegar Chips 200 g'] },
      'Chocolate & Candy': { taxable: true, items: ['Dark Chocolate Bar 100 g', 'Milk Chocolate Almonds 150 g', 'Fruit Gummies 180 g'] },
      'Cookies': { taxable: true, items: ['Shortbread Cookies 325 g', 'Oatmeal Cookies 300 g', 'Ginger Snaps 250 g'] },
  } },
  { category: 'Dry Goods & Baking', subs: {
      'Pasta & Grains': { taxable: false, items: ['Spaghetti 500 g', 'Penne 500 g', 'Basmati Rice 2 kg', 'Rolled Oats 1 kg'] },
      'Baking': { taxable: false, items: ['All-Purpose Flour 2.5 kg', 'Cane Sugar 2 kg', 'Pure Maple Syrup 500 ml', 'Baking Soda 500 g'] },
  } },
];
const CLAIMS = ['glutenFree', 'vegan', 'peanutsFree', 'treeNutsFree', 'eggFree', 'kosher', 'nonGmo', 'lowSodium', 'noSugarAdded'];

const products = [];
let n = 0;
for (const { category, subs } of TAXONOMY) {
  for (const [subcategory, spec] of Object.entries(subs)) {
    for (const base of spec.items) {
      // Three variants per base item (e.g. brand / organic) to reach ~200 products.
      for (const variant of [0, 1, 2]) {
        n++;
        const organic = variant === 1 && chance(0.6);
        const brand = pick(BRANDS);
        const name = `${brand} ${organic ? 'Organic ' : ''}${base}`;
        const perWeight = spec.weighed ? chance(spec.weighed) : false;
        const unitPriceCents = perWeight ? cents(1.5, category === 'Meat & Seafood' ? 36 : 12) : cents(1.5, 24);
        const product = {
          external_id: `DEMO-${String(n).padStart(4, '0')}`,
          name,
          brand,
          category,
          subcategory,
          description: `${name}. Synthetic demo product.`,
          pricing_model: perWeight ? 'per_weight' : 'each',
          unit: perWeight ? 'lb' : 'ea',
          unit_price_cents: unitPriceCents,
          sell_by: perWeight ? (chance(0.5) ? 'quantity' : 'weight') : 'quantity',
          avg_weight_lb: perWeight ? (chance(0.8) ? Math.round((0.4 + rand() * 1.6) * 100) / 100 : null) : null,
          tax_code: spec.taxable ? 'HST_STANDARD' : 'ZERO_RATED',
          deposit_cents: spec.deposit ? pick([10, 10, 25]) : 0,
          available_days: spec.days && chance(0.5) ? DAYS.slice(0, 6) : [],
          min_qty: 0,
          max_qty: 0,
          organic,
          dietary_claims: CLAIMS.filter(() => chance(0.12)),
          availability: chance(0.03) ? 'out_of_stock' : 'in_stock',
          promotion: chance(0.12) ? { sale_price_cents: Math.max(99, Math.round(unitPriceCents * 0.8 / 10) * 10 - 1), label: 'Special' } : null,
          sku: `SKU${String(100000 + n)}`,
          images: [IMAGES[base]?.image ?? PLACEHOLDER_IMAGE],
        };
        products.push(product);
      }
    }
  }
}
// Synthetic UPC-A codes (G4-10/11), derived from the item number so the random stream (and every
// price) is unchanged. Packaged items use number system 4 (GS1 "restricted circulation": in-store
// codes that can never collide with a real product). Weighed items use the variable-measure layout
// 2 IIIII VVVVV C with the value zeroed: the store's scale prints the same item code with the
// price embedded, and the console decodes it (src/modules/fulfilment/barcode.ts).
const upcCheckDigit = (d11) => {
  const sum = [...d11].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
};
products.forEach((p, i) => {
  const item = String(i + 1).padStart(5, '0');
  const d11 = p.pricing_model === 'per_weight' ? `2${item}00000` : `42026${item}0`;
  p.upc = d11 + upcCheckDigit(d11);
});

// Explicit edge cases the system must handle.
products[3].min_qty = 3;
products[10].max_qty = 6;

// ---- coverage assertions
const must = (cond, msg) => { if (!cond) throw new Error(`fixture coverage missing: ${msg}`); };
must(products.some((p) => p.pricing_model === 'each'), 'each pricing');
must(products.some((p) => p.pricing_model === 'per_weight' && p.sell_by === 'weight'), 'per-weight sold by weight');
must(products.some((p) => p.pricing_model === 'per_weight' && p.sell_by === 'quantity'), 'per-weight sold by quantity');
must(products.some((p) => p.pricing_model === 'per_weight' && p.avg_weight_lb === null), 'per-weight without avg weight');
must(products.some((p) => p.tax_code === 'HST_STANDARD') && products.some((p) => p.tax_code === 'ZERO_RATED'), 'both tax codes');
must(products.some((p) => p.deposit_cents > 0), 'bottle deposits');
must(products.some((p) => p.available_days.length > 0), 'day-restricted availability');
must(products.some((p) => p.promotion), 'promotions');
must(products.some((p) => p.availability === 'out_of_stock'), 'out-of-stock items');
must(products.some((p) => p.dietary_claims.length > 0), 'dietary claims');
must(products.some((p) => p.min_qty > 0) && products.some((p) => p.max_qty > 0), 'quantity limits');
must(new Set(products.map((p) => p.external_id)).size === products.length, 'unique external ids');
must(new Set(products.map((p) => p.upc)).size === products.length, 'unique UPCs');
must(products.some((p) => p.upc.startsWith('2')), 'variable-measure (scale label) UPCs');
must(products.some((p) => p.images[0] === PLACEHOLDER_IMAGE), 'products without a photo (placeholder)');
const PUBLIC = path.join(DIR, '../../web/summerhill-commerce/public');
for (const { image } of Object.values(IMAGES)) must(fs.existsSync(path.join(PUBLIC, image)), `image file ${image}`);
for (const item of Object.keys(IMAGES)) must(TAXONOMY.some((c) => Object.values(c.subs).some((s) => s.items.includes(item))), `image for unknown item "${item}"`);

const fixture = {
  generated_by: 'db/seed/generate.mjs',
  seed: SEED,
  merchant: { slug: 'demo-market', name: 'Demo Market', min_order_cents: 1500 },
  location: { slug: 'downtown', name: 'Demo Market Downtown', address_line1: '100 Example Street', city: 'Toronto', province: 'ON', postal_code: 'M5V 0A0' },
  products,
};
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n');
const count = (f) => products.filter(f).length;
console.log(`seed: wrote ${products.length} products to ${path.relative(process.cwd(), OUT)}`);
console.log(`  per_weight=${count((p) => p.pricing_model === 'per_weight')} taxable=${count((p) => p.tax_code === 'HST_STANDARD')} promos=${count((p) => p.promotion)} deposits=${count((p) => p.deposit_cents > 0)} day-restricted=${count((p) => p.available_days.length)} out_of_stock=${count((p) => p.availability === 'out_of_stock')}`);
