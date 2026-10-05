# Current State (as-is) and Gap Analysis

Status: Historical (v0.2, 2026-09-27) · Parent: [BLUEPRINT](../BLUEPRINT.md)

> **Historical.** This is the review of the prototype before the rebuild (G1–G7). The gaps it lists were closed in G1 and G2 (see the [plan](../IMPLEMENTATION_PLAN.md)); for the system as built, read [SYSTEM_DESIGN](SYSTEM_DESIGN.md). Kept for traceability.
Snapshot of branch `stripe-connect-marketplace` @ `e74124d` plus uncommitted Stage 4 work.

## 1. Architecture today

```mermaid
flowchart LR
  UP[Upstream store API] -->|scripts/scraper.js<br/>manual, spoofed headers| J[(scraped.json)]
  J -->|scripts/load-data.js| PG[(Postgres 'summerhill'<br/>creds hardcoded)]
  PG -->|scripts/load-elasticsearch.js| ES[(ES index 'products')]
  DG[dagster/ job: 2 subprocess ops<br/>no schedule, no scrape step] -.-> PG
  subgraph NX[Next.js + Payload app]
    API[/api/products, /[id], /search, /categories/]
    CO[/api/checkout/]
    ADM[/api/admin/merchants/*, /demo/*<br/>no auth/]
    UI[Storefront pages + cart - Zustand/localStorage]
    PL[Payload CMS + ecommerce plugin<br/>own carts/orders/Stripe adapter]
  end
  API --> PG & ES
  CO --> STR[Stripe Checkout<br/>destination charge + fee]
  ADM --> SC[Stripe Connect Custom] & PG
  PL --> PPG[(Payload DB)]
  STR -. no consumer .-> N((∅))
```

## 2. Inventory: keep / change / delete

| Component | Path | Verdict | Notes |
|---|---|---|---|
| Scraper | `scripts/scraper.js` | **Rewrite** as connector | Drops ~20 fields we need (tax, unit, promos, deposits…); spoofs headers; `process.exit` on error |
| `schema/schema.sql` | | **Delete** (replace with migrations) | Seed row `('Chips', 999)` violates the FK, so a fresh DB fails |
| `db/migrations/004_add_merchants.sql` | | **Fold into** migration 001–00n | 001–003 never existed; no runner |
| `scripts/load-data.js` | | **Rewrite** | Uses `product.name` (display name) as PK → 50 products lost (3,150 → 3,100); `ON CONFLICT` updates only `name`; no transaction |
| `scripts/create-es-index.js`, `load-elasticsearch.js` | | **Rewrite** | Minimal mapping; one PUT per doc; no alias; missing fields |
| `dagster/dagster_pipeline.py` | | **Keep the concept, rewrite** | No schedule, no retries per op, no scrape op; `__pycache__` committed |
| `lib/catalogDb.ts`, `lib/esClient.ts` | | **Change** | Hardcoded host/user/password |
| `lib/stripe.ts` | | Keep | Pin API version in config; add `maxNetworkRetries` |
| `lib/cartStore.ts` | | **Change** | Keep as a client cache; server cart is authoritative; weighed-unit steps; per-merchant |
| `lib/connect/revenueShare.ts` | | **Keep**, extend | Correct, pure, cents. Add fee-schedule versioning; decide on marginal tiers (B2); unit tests |
| `lib/connect/merchantDb.ts` | | **Change** | `updateMerchantStatus` interpolates object keys into SQL → needs an allow-list; status derivation duplicated in routes |
| `app/api/products*`, `categories` | | **Change** | Move to `/api/v1`; filters; hide inactive; zod |
| `app/api/checkout/route.ts` | | **Rewrite** | Trusts client price/name; no tax; no order row; no idempotency; hardcoded `cad`; no manual capture |
| `app/api/admin/merchants/**` | | **Rewrite behind auth** | No auth; test fixtures (`address_full_match`, `tax_id 000000000`, `tos_acceptance.ip 127.0.0.1`) inline |
| `app/api/admin/demo/separate-charge-transfer` | | **Move to test-only** | Demo; fine to keep as a reference under the test flag |
| `app/admin/merchants/page.tsx` | | **Rewrite** | Public; shadows Payload's `/admin/[[...segments]]` at `/admin/merchants` |
| `web/summerhill-commerce/web/...` | | **Delete** | Accidental nested duplicate of the onboard route |
| Payload ecommerce plugin (carts, orders, transactions, addresses, Stripe adapter) | `src/plugins/index.ts` + template pages `checkout/confirm-order`, `orders`, `find-order` | **Remove commerce parts** (ADR-0003) | Second checkout system; its webhook endpoint is configured but unused by our checkout |
| Payload `Products` collection | `src/collections/Products` | **Remove** | Second product source of truth |
| Payload Users, Pages, Media, Header/Footer, forms, SEO | | **Keep** | Auth + marketing content |
| Template seed (`endpoints/seed`, hats/t-shirts) | | **Delete** | Irrelevant sample data |
| Template tests | `tests/` | **Replace** | Tests cover template behaviour, not ours |
| Root scratch files | `audit.js`, `inspect.js`, `investigate.js`, `test.js` | Delete (already gitignored) | |
| `.env.example` | | **Rewrite** | Still the Payload template's (Mongo URL, "Payload Inc.") |

## 3. Gap analysis

Severity: 🔴 blocks handling real money · 🟠 blocks pilot · 🟡 hygiene. "Fix in" refers to [DELIVERY_PLAN](../DELIVERY_PLAN.md) milestones.

### 3.1 Security & money correctness

| # | Sev | Gap | Consequence | Fix in |
|---|---|---|---|---|
| GAP-01 | 🔴 | No authn/authz on `/api/admin/*`, `/admin/merchants` | Anyone can trigger payouts, change schedules, create accounts | M0 |
| GAP-02 | 🔴 | Checkout prices/names from the client | Pay $0.01 for anything | M0 |
| GAP-03 | 🔴 | No webhook consumer, no order record | Paid orders lost; nothing to fulfil or refund | M1 |
| GAP-04 | 🔴 | No idempotency (checkout, payouts, transfers) | Duplicate charges or payouts on retry | M0–M1 |
| GAP-05 | 🔴 | DB credentials hardcoded and committed | Leaked; must rotate | M0 |
| GAP-06 | 🔴 | **No sales tax** charged | HST under-collected on 30% of products → merchant liability | M1 |
| GAP-07 | 🔴 | **Weighed items charged at the fixed "1 lb" price once** | Over- or under-charging on 263 products | M1/M3 |
| GAP-08 | 🟠 | Fake `tos_acceptance` + test KYC in production code | Compliance breach in live mode | M0 |
| GAP-09 | 🟠 | SQL built from object keys in `updateMerchantStatus` | Injection risk if keys are ever user-controlled | M0 |
| GAP-10 | 🟠 | No input validation on any route body | 500s, Stripe errors, abuse | M0 |
| GAP-11 | 🟠 | No rate limiting / bot protection on checkout | Card-testing attacks → dispute fees, Stripe account risk | M1 |

### 3.2 Product capability gaps (the "missing system")

| # | Sev | Capability | Status | Fix in |
|---|---|---|---|---|
| GAP-12 | 🔴 | Order management (state machine, timeline) | Missing | M1 |
| GAP-13 | 🔴 | **Fulfilment: merchant console, accept/reject, pick, weigh, substitute, handover** | Missing entirely | M3 |
| GAP-14 | 🔴 | Pickup slots, store hours, capacity, lead times | Missing | M3 |
| GAP-15 | 🔴 | Customer notifications (confirmation, ready, substitution, receipt) | Missing | M1/M3 |
| GAP-16 | 🟠 | Promotions / sale prices | Ignored (we charge the regular price) | M2 |
| GAP-17 | 🟠 | Deposits, min/max qty, `availableDays`, units | Dropped by the scraper | M2 |
| GAP-18 | 🟠 | Server-side cart, one merchant per cart, re-pricing | Browser-only cart | M1 |
| GAP-19 | 🟠 | Refunds, cancellations, disputes | Missing | M4 |
| GAP-20 | 🟠 | Payout management + reconciliation + ledger | Payout demo only | M4 |
| GAP-21 | 🟠 | Admin console (orders, merchants, catalogue overrides, audit) | One read-only table | M4 |
| GAP-22 | 🟠 | Customer support flow (report a problem, agent tools) | Missing | M4 |
| GAP-23 | 🟠 | Background job system (retries, schedules) | None; everything inline in requests | M1 |
| GAP-24 | 🟠 | Catalogue sync frequency and freshness (only manual) | Stale prices | M2 |
| GAP-25 | 🟠 | Images self-hosted (currently hotlinked from another vendor's bucket) | Breaks if they change it; rights | M2 |
| GAP-26 | 🟡 | Product descriptions (all empty) | SEO/conversion | Post-pilot |
| GAP-27 | 🟠 | Legal pages: Terms, Privacy, merchant agreement, refund policy | Missing | M1–M5 |

### 3.3 Engineering foundations

| # | Sev | Gap | Fix in |
|---|---|---|---|
| GAP-28 | 🟠 | Migrations broken / no runner | M0 |
| GAP-29 | 🟠 | Two checkout systems, two product models | M0 (decision) / M1 (removal) |
| GAP-30 | 🟠 | No tests on our code, no CI | M0 onward |
| GAP-31 | 🟠 | No observability (logs, errors, metrics, alerts) | M1/M5 |
| GAP-32 | 🟠 | No environments beyond local; no deploy pipeline | M0/M5 |
| GAP-33 | 🟡 | No docker-compose; onboarding takes hours | M0 |
| GAP-34 | 🟡 | Repo naming (`summerhill-scraper`) no longer describes the product | M0 (optional) |
| GAP-35 | 🟡 | Money as `NUMERIC` dollars + scattered `Math.round(x*100)` | M1 |

## 4. What is genuinely good and should be preserved

- `revenueShare.ts`: integer-cent maths, input validation, clear comments on why.
- Merchant status derivation in `simulate-verification` correctly separates `charges_enabled` from `payouts_enabled`.
- Onboarding creates the person before `directors_provided`: correct ordering, with the reason documented.
- The checkout returns 503 when the merchant can't accept charges (right status code and reasoning).
- Conventional commits with clear stages.
- Parameterised SQL in the catalogue routes.
