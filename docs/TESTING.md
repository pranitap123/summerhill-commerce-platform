# Test Strategy

Status: v1.0 · Updated 2026-09-29 · Parent: [BLUEPRINT](BLUEPRINT.md)

> **Current** for the suites and gates as built (§2.1 has the measured results). Rows about staging, UAT with store staff and an external pen test describe a real launch.

## 1. Principles

- **Test money and permissions exhaustively; test UI enough.** Bugs in pricing, capture, refunds or authz cost real money or trust; a misaligned button doesn't.
- Tests run in CI on every PR and block merge. No "we'll add tests later" for money/auth code (CODEOWNERS enforce this in review).
- Integration tests use **real Postgres** (Testcontainers), not mocks. Stripe is exercised with **test mode** plus signed fixture events; `stripe-mock` for fast unit-level adapter tests.
- Every bug fix comes with a test that fails without the fix.

## 2. Test pyramid and tooling

| Layer | Tooling | Scope | Runs |
|---|---|---|---|
| Unit | Vitest (TS), pytest (pipeline) | pricing, fee, tax, rounding, state machine, slot rules, status derivation, connectors' `normalise` | every PR, < 1 min |
| Property-based | fast-check / hypothesis | money invariants over random baskets | every PR |
| Integration | Vitest + Testcontainers (Postgres) + stripe-mock / Stripe test mode | route handlers → DB; webhook handler; jobs; ingest end-to-end on fixtures | every PR, < 8 min |
| Contract | OpenAPI response validation | every public endpoint | every PR |
| E2E | Playwright | critical journeys across storefront and merchant console, against the app with the payment simulator (Stripe's test cards, incl. 3-D Secure; no Stripe account needed) | every PR (smoke), nightly (full) |
| Accessibility | axe-core in Playwright | storefront + console key pages | nightly |
| Performance | k6 | search, product pages, checkout, console polling at 2× peak | before pilot + monthly |
| Security | authz matrix (automated), ZAP baseline, external pen test | all routes | every PR / weekly / pre-launch |
| Resilience | fault injection in staging (Stripe timeout, DB failover, search down) | fallbacks, retries | pre-launch |
| DR | restore + webhook replay drill | data | pre-launch, quarterly |
| UAT | scripted sessions with merchant staff on real tablets | pick/weigh/substitute/handover | M3, M5 |

Coverage gates (G6-03, `vitest.config.mts`, enforced by `npm run test:coverage` and the full `npm run ci:local`): the pure money and state logic (`pricing/{money,fees,final,quote,revenueShare}`, `payments/{ledgerRules,refundMath}`, `ordering/stateMachine`) at **100% of lines, branches and functions**; overall ≥ 75% of lines across `src/modules`, `src/server` and `src/worker`. The I/O-heavy parts of `payments` and `payouts` are covered by the integration suite instead of a per-file gate.

### 2.1 Quality, security and performance results (G6, 2026-09-28)

Measured on the development machine (Windows 10, 8 GB RAM, the whole stack in Docker on the same box, Lighthouse CPU benchmark index 216, where a typical laptop scores 1,000+). Performance numbers from this machine are a floor, not a verdict: rerun `npm run test:load` and `npm run test:lighthouse` on a CI-class runner before the pilot.

| Check | Command | Result |
|---|---|---|
| Security headers | `npm run scan:headers` | Observatory rules **A+** (115) on every page |
| OWASP ZAP baseline | `npm run scan:zap` | **0 High**, 1 Medium accepted (`style-src 'unsafe-inline'`, needed by Next.js/Radix inline styles), rules in `infra/zap/rules.tsv` |
| Coverage gates | `npm run test:coverage` | money/state files 100%; overall 84% lines (gate 75%) |
| Accessibility (axe, WCAG 2.1 AA) | `npx playwright test tests/e2e/accessibility.spec.ts` | **0 serious/critical** on 21 storefront, checkout, console and `/ops` pages; checkout completed with the keyboard alone |
| Resilience | `tests/integration/resilience.test.ts`, `tests/unit/outbound.test.ts`, catalog suite | Stripe timeout and a worker crash mid-capture each end with exactly one capture and one ledger journal; search falls back to Postgres at once when Elasticsearch hangs |
| Tracing | `tests/integration/tracing.test.ts` | one checkout → webhook → order placed → email is one trace |

**Found and fixed by these checks:** the CSP blocked the Google Fonts stylesheet (the site had silently fallen back to system fonts), so the fonts are now self-hosted with `next/font` and no third-party request remains; low-contrast form labels; an unlabelled menu button; a `<p>` inside a `<dl>` on the order page; credential forms without `method="post"`; the Elasticsearch client's socket timeout capped every per-request timeout at 3 s (the 30 s index-rebuild budget had never applied).

**Load test (k6, `tests/load/storefront.js`).** Peak for the one-store pilot is defined in the script: ~30 shoppers searching and opening product pages about every 10 s and ~6 orders a minute. The run is 2× that as fixed arrival rates for 2 minutes (search 6/s, product pages 6/s, checkout 0.2/s):

| Flow | Target p95 | Measured p95 (median) | |
|---|---|---|---|
| Product page | < 800 ms | 699 ms (73 ms) | ✅ |
| Search API | < 300 ms | 5.2 s (432 ms) | ❌ |
| Checkout | < 1.5 s | 4.4 s (625 ms) | ❌ |
| Errors | < 1% | 0.27% | ✅ |

Search misses because Elasticsearch itself is saturated on this machine: queried directly with 6 parallel clients and no app in front, its p95 is 3.4 s (median 217 ms). The circuit breaker then opens and the Postgres fallback serves the rest, as designed. One at a time, warm, a search takes 50–80 ms.

**Lighthouse CI (`lighthouserc.cjs`, 5 storefront pages, median of 3, mobile).** Budgets are enforced and currently fail on this machine for performance only. Before the fixes above: performance 0.62–0.77 (total blocking time 0.5–1.6 s under 4× CPU throttling on a benchmark-216 CPU), accessibility 0.94–0.95, best practices 0.93 (CSP console errors), 1 third-party request. After: accessibility, best practices and SEO 1.0 on the home page, 0 third-party requests, JS 187 kB, fonts 120 kB, total 380 kB (budget 900 kB). The cart page's SEO score is 0.63 by design: it is `noindex`. On a slow machine set `LHCI_CPU_SLOWDOWN=1` (Lighthouse's calibration guidance); the budgets don't change.

## 3. Mandatory test cases

### 3.1 Fee calculation (flat tiers per the brief)

| Subtotal (¢) | Rate | Fee (¢) | Merchant from items (¢) |
|---|---|---|---|
| 0 | 20% | 0 | 0 |
| 1 | 20% | 0 | 1 |
| 4999 | 20% | 1000 | 3999 |
| 5000 | 15% | 750 | 4250 |
| 10000 | 15% | 1500 | 8500 |
| 10001 | 10% | 1000 | 9001 |
| 7756 | 15% | 1163 | 6593 |
| −1, 1.5, NaN, 2^53 | throws | | |

Marginal mode: 5000 → 1000; 10000 → 1750; 10001 → 1750; 20000 → 2750.
Property: `fee + net == subtotal`, `0 ≤ fee ≤ subtotal × 0.2`.

### 3.2 Pricing / quote
- Per-weight line: 1.62 lb × 3599¢ = 5830¢ (half-up rounding: 5830.38 → 5830).
- HST per line: 499¢ × 13% = 64.87 → 65¢; zero-rated → 0.
- Promotion applied only while present; the lower price wins when several apply.
- Deposit not commissionable and not included in the fee base.
- Weight buffer = 15% of weighed lines only.
- **Golden test:** the worked example in [PAYMENTS §9](domains/PAYMENTS_AND_MONEY.md#9-ledger) reproduces exactly (auth 8779¢, captured 7821¢, fee 1163¢, transfer 6658¢).
- Quote hash is stale after a price change → `409 PRICE_CHANGED`.

### 3.3 Checkout and payments
- Tampered body (extra `price` field) → 400; with only IDs, the charged amount equals the DB price.
- Mixed merchants in the cart → 422 `CART_MIXED_MERCHANTS`.
- Merchant not live / paused / `charges_enabled=false` → 503/422.
- Same `Idempotency-Key` twice → one order, one Stripe session; same key with a different body → 422.
- Slot full under concurrency: 20 parallel checkouts for a capacity-5 slot → exactly 5 holds.
- Capture with final < auth → captures final, fee on the final subtotal, transfer = total − fee.
- Final = 0 → PaymentIntent cancelled, order cancelled.
- Final > auth → capture capped; difference recorded as platform absorption.
- Capture error → retries with the same idempotency key → `payment_issue` after 5.
- Refund matrix: merchant liability → `reverse_transfer` + `refund_application_fee` true; platform → both false; ledger entries balance.

### 3.4 Webhooks
- Invalid signature → 400, nothing stored.
- Duplicate delivery → processed once.
- Out-of-order (`expired` after `completed`) → illegal transition rejected and logged, no state change.
- Unknown event type → stored, acknowledged, ignored.
- Handler crash → event retried by the job; the Stripe response was already 200.

### 3.5 Order state machine
- Table test of every (from, to) pair: allowed ones succeed, all others throw.
- Concurrency: accept and customer-cancel at the same instant → exactly one wins.
- Auto-reject fires at 15 min only if still `placed`.

### 3.6 Authorisation matrix (generated)
For **every** registered route × {anonymous, customer A, customer B, merchant_staff M1, merchant_staff M2, support, finance, admin} → expected {200, 401, 403, 404}. Includes cross-tenant cases: customer A reading B's order, M1 staff reading M2's order. The route registry fails CI if a route has no declared policy.

### 3.7 Catalogue ingest (pytest on recorded fixtures)
- Re-run with an identical feed → 0 writes.
- Price change → 1 update + outbox event.
- Missing product → deactivated; returns → reactivated.
- Feed with 50% of rows → run held (anomaly guard), live catalogue untouched.
- Quarantine rules (price 0, missing id, 3 decimals).
- Duplicate UPC promo applies to both products with a warning.
- `isAlcohol` → blocked.
- `normalise` maps all fields in [CATALOG §3](domains/CATALOG_AND_SEARCH.md#3-canonical-product-model), including `lb` → per_weight.

### 3.8 E2E journeys (Playwright)
Journeys 1–6 are in `web/summerhill-commerce/tests/e2e/fulfilment.spec.ts` (G4-18). They run against the app with the payment simulator, which accepts the same Stripe test card numbers, so no Stripe account or network access is needed; journey 1 fills the cart through the API rather than search/PDP (covered by the G3 tests). Journeys 7–9 are in `tests/e2e/backoffice.spec.ts` (G5-19); staff sign in with a password and the second factor (TOTP from the demo secret, G5-12).

1. Guest: search → PDP → add weighed + taxable items → slot → Stripe test card `4242…` → confirmation shows the hold and pickup code.
2. Merchant: login → accept → weigh → substitute → mark unavailable → complete → customer sees "ready" with the final total.
3. Handover with the right and the wrong code.
4. Customer cancels before acceptance → hold released.
5. Declined card (`4000 0000 0000 0002`) → friendly error, order stays `pending_payment` then `abandoned`.
6. 3DS card (`4000 0027 6000 3184`, or `4000 0025 0000 3155`) flow: failed and completed challenge.
7. Support refund of one line → customer email, ledger, merchant statement line. *(As built: the support agent's menu has no payouts; the refund form's result and the customer's order page are checked; email, ledger and statement are checked to the cent in `tests/integration/backoffice.test.ts`.)*
8. Admin: onboard merchant (test mode) → go-live blocked until `charges_enabled`. *(As built: Stripe-hosted Express onboarding, simulated; after `account.updated` the merchant is verified and go-live is still blocked until a catalogue is published.)*
9. Test-mode dispute (card `4000 0000 0000 0259`) → evidence pack with the handover record → evidence submitted (G5-06).

## 4. Test data and environments

- Seeded fixtures: 1 merchant, 60 products covering every pricing model/tax code/promo/deposit/availability rule, slots for 7 days, users for every role.
- Upstream feed fixtures: recorded JSON (anonymised) in `pipeline/tests/fixtures/`.
- Stripe: a test-mode platform account per environment; Connect test accounts created by the seed script using Stripe's documented test values (**only in test code**).
- No production data in lower environments. From M5, an anonymised production snapshot is used for migration testing.

## 5. UAT and pilot testing

| Stage | Who | Exit criteria |
|---|---|---|
| Internal dogfood (M3 end) | Team + friends, staging, test cards | All P0 journeys pass; no SEV1/2 bugs open |
| Merchant UAT (M5) | Summerhill pickers + manager, real tablets, 2 sessions | Pick of a 20-line order < 10 min; staff rate the console usable; all UAT defects triaged |
| Closed pilot | 20–50 invited customers, live mode, real money | 50 orders; reconciliation clean for 7 days; problem rate ≤ 5% |
| Public pilot | Open | Metrics in [PRD §8](product/PRD.md#8-success-metrics) |

## 6. Definition of Done (per story)

- [ ] Acceptance criteria met, demoed
- [ ] Unit + integration tests; authz rows added to the matrix for new routes
- [ ] OpenAPI updated; migrations reviewed
- [ ] Logs/metrics/alerts for new failure modes
- [ ] Docs/runbook updated if behaviour or operations changed
- [ ] Feature flag if risky; rollback path known
- [ ] Reviewed (2 reviewers for money/auth/PII)
