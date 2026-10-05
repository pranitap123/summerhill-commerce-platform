# Requirements Traceability Matrix

Status: v1.0 · Updated 2026-09-28 · Plan: [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)

**Purpose:** prove that the implementation plan covers *everything* the documents require. Every requirement from every source document appears here once, mapped either to work items or to an explicit decision. `node docs/tools/check-docs.mjs` verifies:
- that every requirement in the sources has a row here
- that every referenced work item exists in the plan
- that all internal links resolve

**Dispositions**

| Code | Meaning |
|---|---|
| **Plan** | Implemented by the listed work items (★ = core track) |
| **Stretch** | Optional showcase in G8, after v1.0.0 |
| **Backlog** | Valid, but deliberately after v1.0.0; listed in the plan's backlog |
| **Won't** | Deliberately not built ([FEATURE_ROADMAP §4](product/FEATURE_ROADMAP.md#4-what-we-will-deliberately-not-build-and-why)) |
| **OOS** | Out of scope for a GitHub reference implementation (real business/production only) |

---

## 1. Use cases ([PRD §4](product/PRD.md#4-use-cases))

| Req | Requirement | Disposition | Work items |
|---|---|---|---|
| S1 | Browse by category/subcategory | Plan | G3-09, G3-13, G3-14 |
| S2 | Search | Plan | G3-08, G3-09 |
| S3 | Product page | Plan | G3-10 |
| S4 | Cart | Plan | G2-06, G2-12 |
| S5 | Choose pickup slot | Plan | G4-02, G4-03 |
| S6 | Replacement preferences | Plan | G4-04 |
| S7 | Pay | Plan | G2-05, G2-07 |
| S8 | Order confirmation | Plan | G2-13, G2-14 |
| S9 | Order tracking | Plan | G2-13, G4-12 |
| S10 | Approve/decline substitutions | Plan | G4-12 |
| S11 | Cancel order | Plan | G4-15 |
| S12 | Report a problem | Plan | G5-11 |
| S13 | Account: sign up/in, reset, preferences | Plan | G2-20 |
| S14 | Order history + reorder | Plan | G2-13, G4-19 |
| S15 | Guest order access | Plan | G2-13, G2-20 |
| S16 | Delivery | Stretch | G8-04 |
| S17 | Saved cards | Stretch | G8-07 |
| M1 | Staff sign-in | Plan | G4-05, G5-12 |
| M2 | New-order alert | Plan | G4-06 (SMS escalation: OOS, email/console only) |
| M3 | Accept / reject | Plan | G4-07 |
| M4 | Pick list | Plan | G4-08 |
| M5 | Record actual weight | Plan | G4-09, G4-11 |
| M6 | Substitute | Plan | G4-12 |
| M7 | Mark unavailable | Plan | G4-09 |
| M8 | Complete picking | Plan | G4-13 |
| M9 | Handover | Plan | G4-14 |
| M10 | Hours, capacity, lead times, closures | Plan | G4-01 |
| M11 | Temporarily hide product | Plan | G4-20, G3-11 |
| M12 | Sales, fees, payouts, statements | Plan | G5-08, G5-13 |
| M13 | Pause store | Plan | G4-01 |
| A1 | Merchant lifecycle | Plan | G5-02 |
| A2 | Merchant health | Plan | G5-02, G2-11 |
| A3 | Connector config + ingest runs | Plan | G5-14, G3-05, G3-06 |
| A4 | Catalogue overrides | Plan | G3-11, G5-14 |
| A5 | Order search + timeline | Plan | G5-03 |
| A6 | Refunds | Plan | G5-04 |
| A7 | Cancel on behalf | Plan | G5-04 |
| A8 | Disputes | Plan | G5-06 |
| A9 | Payouts | Plan | G5-07 |
| A10 | Reconciliation report | Plan | G5-05 |
| A11 | User management + roles | Plan | G5-15 |
| A12 | Audit log viewer | Plan | G5-09 |
| A13 | Feature flags / kill switches | Plan | G5-10 |
| X1 | Catalogue delta + nightly sync with anomaly guard | Plan | G3-05, G3-12 |
| X2 | Search projection sync + nightly rebuild | Plan | G3-08 |
| X3 | Webhooks exactly once | Plan | G2-08 |
| X4 | Auto-reject; auth-expiry guard | Plan | G4-07, G2-19 |
| X5 | Release slot holds; expire abandoned checkouts | Plan | G4-02, G2-08 |
| X6 | Daily reconciliation + invariants | Plan | G5-05 |
| X7 | Notifications with retries + delivery log | Plan | G2-14, G4-17 |
| X8 | Data retention jobs | Plan | G5-16 |

## 2. Gaps in the current code ([CURRENT_STATE §3](architecture/CURRENT_STATE.md#3-gap-analysis))

| Req | Gap | Disposition | Work items |
|---|---|---|---|
| GAP-01 | No authn/authz on admin | Plan | G1-06, G1-16 |
| GAP-02 | Client-supplied prices | Plan | G1-07, G2-05, G2-07 |
| GAP-03 | No webhook consumer / order record | Plan | G2-01, G2-08, G2-09 |
| GAP-04 | No idempotency | Plan | G2-04, G5-07 |
| GAP-05 | Hardcoded DB credentials | Plan | G1-02, G0-03 |
| GAP-06 | No sales tax | Plan | G2-05 |
| GAP-07 | Weighed items mispriced | Plan | G2-05, G4-09, G4-13 |
| GAP-08 | Fake ToS / test KYC in runtime | Plan | G1-10 |
| GAP-09 | SQL from object keys | Plan | G1-09 |
| GAP-10 | No input validation | Plan | G1-08 |
| GAP-11 | No rate limiting / bot protection | Plan | G2-16 (Radar rules: OOS; need a paid Radar tier) |
| GAP-12 | No order management | Plan | G2-09, G5-03 |
| GAP-13 | No fulfilment | Plan | G4-01 … G4-20 |
| GAP-14 | No slots / hours / capacity | Plan | G4-01, G4-02, G4-03 |
| GAP-15 | No notifications | Plan | G2-14, G4-17 |
| GAP-16 | Promotions ignored | Plan | G3-07 |
| GAP-17 | Deposits, min/max, availability days, units dropped | Plan | G3-04, G2-06 |
| GAP-18 | Browser-only cart | Plan | G2-06 |
| GAP-19 | No refunds/cancellations/disputes | Plan | G4-15, G5-04, G5-06 |
| GAP-20 | No payout management / reconciliation / ledger | Plan | G2-10, G5-05, G5-07 |
| GAP-21 | No admin console | Plan | G5-01 … G5-19 |
| GAP-22 | No support flow | Plan | G5-11 (agent "view as customer": Backlog) |
| GAP-23 | No background jobs | Plan | G2-03 |
| GAP-24 | Manual catalogue sync only | Plan | G3-12 |
| GAP-25 | Images hotlinked | Plan | G0-04 (placeholders); CDN mirroring: OOS |
| GAP-26 | Empty descriptions | Plan | G1-13 (synthetic descriptions); real enrichment: Backlog |
| GAP-27 | No legal pages | Plan | G0-05 (disclaimer + demo terms page); real legal documents: OOS |
| GAP-28 | Broken migrations | Plan | G1-03 |
| GAP-29 | Two checkout systems / product models | Plan | G2-15 |
| GAP-30 | No tests / CI | Plan | G1-14, G1-15, G2-17, G6-03 |
| GAP-31 | No observability | Plan | G1-11, G6-08, G6-09 |
| GAP-32 | No environments / deploy pipeline | OOS | G7-06 (optional hosted demo) |
| GAP-33 | No docker-compose | Plan | G1-01 |
| GAP-34 | Repo name doesn't describe the product | Plan | G0-05 |
| GAP-35 | Money as NUMERIC dollars | Plan | G2-02 |

## 3. Background jobs ([SYSTEM_DESIGN §6.2](architecture/SYSTEM_DESIGN.md#62-job-catalogue))

| Req | Job | Disposition | Work items |
|---|---|---|---|
| JOB-stripe.webhook.process | Process webhook events | Plan | G2-08 |
| JOB-notify.send | Send notifications | Plan | G2-14 |
| JOB-orders.acceptanceSweep | Escalate, then auto-reject unaccepted orders | Plan | G4-07 |
| JOB-payment.capture | Capture after picking | Plan | G4-13 |
| JOB-payment.authExpiryGuard | Warn before authorisation expiry | Plan | G2-19 |
| JOB-slots.releaseExpired | Release expired slot holds | Plan | G4-02 |
| JOB-slots.generate | Materialise slots 7 days ahead | Plan | G4-01, G4-02 |
| JOB-orders.noShowSweep | Mark uncollected orders no-show | Plan | G4-14 |
| JOB-checkout.expireAbandoned | Expire abandoned checkouts | Plan | G2-08 |
| JOB-search.upsertProduct | Near-real-time search sync | Plan | G3-08 |
| JOB-search.rebuild | Nightly rebuild + alias swap | Plan | G3-08 |
| JOB-recon.daily | Daily reconciliation | Plan | G5-05 |
| JOB-disputes.deadlineAlerts | Dispute evidence deadline alerts (72 h / 24 h) | Plan | G5-06 |
| JOB-payout.syncStatus | Payout status sync | Plan | G5-07 |
| JOB-retention.purge | Retention purge | Plan | G5-16 |

## 4. API endpoints ([SYSTEM_DESIGN §7.3](architecture/SYSTEM_DESIGN.md#73-endpoint-catalogue))

| Req | Endpoint | Disposition | Work items |
|---|---|---|---|
| API-merchants | `GET /api/v1/merchants` | Plan | G3-13 |
| API-categories | `GET /api/v1/categories` | Plan | G3-09 |
| API-products | `GET /api/v1/products` | Plan | G3-09 |
| API-product | `GET /api/v1/products/{slug}` | Plan | G3-10 |
| API-search | `GET /api/v1/search` | Plan | G3-09 |
| API-cart | `GET/PUT /api/v1/cart`, `POST /api/v1/cart/items` | Plan | G2-06 |
| API-quote | `POST /api/v1/cart/quote` | Plan | G2-05, G2-06 |
| API-slots | `GET /api/v1/cart/slots` | Plan | G4-03 |
| API-replacements | `GET /api/v1/cart/items/{lineId}/replacements` | Plan | G4-04 |
| API-checkout | `POST /api/v1/checkout` | Plan | G2-07 |
| API-order | `GET /api/v1/orders/{publicId}` | Plan | G2-13 |
| API-order-cancel | `POST /api/v1/orders/{publicId}/cancel` | Plan | G4-15 |
| API-substitutions | `POST /api/v1/orders/{publicId}/substitutions/{lineId}` | Plan | G4-12 |
| API-arrived | `POST /api/v1/orders/{publicId}/arrived` | Plan | G4-14 |
| API-rating | `POST /api/v1/orders/{publicId}/rating` · `/reorder` | Plan | G4-19 |
| API-issues | `POST /api/v1/orders/{publicId}/issues` | Plan | G5-11 |
| API-lookup | `POST /api/v1/orders/lookup` | Plan | G2-20 |
| API-me-orders | `GET /api/v1/me/orders` | Plan | G2-13 |
| API-m-locations | `GET /api/console/locations` | Plan | G4-05 |
| API-m-orders | `GET /api/console/locations/{id}/queue` | Plan | G4-06 |
| API-m-accept | `POST /api/console/orders/{publicId}/accept` · `/reject` | Plan | G4-07 |
| API-m-pick | `POST /api/console/orders/{publicId}/start` | Plan | G4-08 |
| API-m-lines | `POST /api/console/orders/{publicId}/lines/{lineId}` | Plan | G4-09, G4-11 |
| API-m-scan | `POST /api/console/orders/{publicId}/scan` | Plan | G4-10, G4-11 |
| API-m-substitute | `POST /api/console/orders/{publicId}/lines/{lineId}/substitute` | Plan | G4-12 |
| API-m-complete | `POST /api/console/orders/{publicId}/complete` | Plan | G4-13 |
| API-m-handover | `POST /api/console/orders/{publicId}/handover` | Plan | G4-14 |
| API-m-settings | `GET/PUT /api/console/locations/{id}/settings` | Plan | G4-01 |
| API-m-availability | `PUT /api/console/locations/{id}/availability/products/{productId}` | Plan | G4-20 |
| API-m-statements | `GET /api/v1/merchant/statements` | Plan | G5-13 |
| API-admin | Admin API (merchants, ingest, overrides, orders, refunds, disputes, payouts, recon, users, flags, audit) | Plan | G5-01 … G5-19 |
| API-webhooks | `/api/webhooks/stripe`, `/stripe-connect` | Plan | G2-08 |
| API-health | `/api/health`, `/api/ready` | Plan | G1-11 |
| API-openapi | OpenAPI spec | Plan | G2-18 |

## 5. Architecture and cross-cutting design

| Req | Requirement | Disposition | Work items |
|---|---|---|---|
| ARC-modules | Modular monolith + boundary rules (ADR-0002) | Plan | G1-05 |
| ARC-worker | Separate worker process | Plan | G2-03 |
| ARC-outbox | Transactional outbox (ADR-0008) | Plan | G2-03 |
| ARC-schemas | Schemas per module + DB roles (ADR-0004) | Plan | G1-18 |
| ARC-migrations | Forward-only migrations | Plan | G1-03 |
| ARC-config | zod-validated config | Plan | G1-02 |
| ARC-flags | DB-backed feature flags | Plan | G2-01, G5-10 |
| ARC-cache | ISR tag revalidation | Plan | G3-13 |
| ARC-http | Timeouts, retries, circuit breakers on outbound calls | Plan | G6-05 |
| ARC-locations | merchant → locations model | Plan | G1-04 |
| ARC-time | Business time in America/Toronto, DST-safe | Plan | G1-12 |
| ARC-money | Integer cents, snapshots (ADR-0006) | Plan | G2-02, G2-05 |
| ARC-charge | Destination charge, on_behalf_of, manual capture (ADR-0005) | Plan | G2-07, G4-13 |
| ARC-cardext | Overcapture / incremental / extended authorisation if available | Plan | G2-07, G4-13; incremental use: Stretch G8-01; extended: Stretch G8-02 |
| ARC-tax | HST per line as a Checkout line (ADR-0009) | Plan | G2-05, G2-07 |
| ARC-single-path | One commerce path (ADR-0003) | Plan | G2-15 |
| ARC-search | Search engine decision (ADR-0007: Elasticsearch) | Plan | G3-08 |
| ARC-pickup | Pickup first (ADR-0010) | Plan | G4 |
| ARC-accounttype | Connect account type (ADR-0011) | Plan | G5-02 |
| ARC-frontend | Storefront, console, /ops split | Plan | G3-13, G4-06, G5-01 |
| ARC-a11y | WCAG 2.1 AA | Plan | G6-04 |
| ARC-perf | Performance budgets | Plan | G6-07 |

## 6. Domain rules

| Req | Rule (source) | Disposition | Work items |
|---|---|---|---|
| DOM-connector | Connector framework ([CATALOG §2](domains/CATALOG_AND_SEARCH.md#2-connector-framework)) | Plan | G3-02, G3-03 |
| DOM-canonical | Canonical product model incl. avgWeight, claims, location ([CATALOG §3](domains/CATALOG_AND_SEARCH.md#3-canonical-product-model)) | Plan | G3-04 |
| DOM-promos | Promotions + effective price ([CATALOG §3.1](domains/CATALOG_AND_SEARCH.md#31-promotions)) | Plan | G3-07 |
| DOM-overrides | Overrides survive re-ingest ([CATALOG §3.2](domains/CATALOG_AND_SEARCH.md#32-overrides-merchant-or-admin-edits-that-survive-re-ingest)) | Plan | G3-11 |
| DOM-quality | Quality rules + anomaly guard ([CATALOG §4](domains/CATALOG_AND_SEARCH.md#4-data-quality-rules)) | Plan | G3-05 |
| DOM-stock | "Out of stock today"; unavailability metric ([CATALOG §5](domains/CATALOG_AND_SEARCH.md#5-stock-and-availability)) | Plan | G4-20, G5-18 |
| DOM-images | Image mirroring ([CATALOG §6](domains/CATALOG_AND_SEARCH.md#6-images)) | OOS | placeholders in G0-04 |
| DOM-taxonomy | Taxonomy + mapping ([CATALOG §7](domains/CATALOG_AND_SEARCH.md#7-taxonomy)) | Plan | G3-14 |
| DOM-search | Relevance, synonyms, analytics ([CATALOG §8](domains/CATALOG_AND_SEARCH.md#8-search)) | Plan | G3-08, G3-15 |
| DOM-cart | Cart rules ([ORDERS §1](domains/ORDERS_AND_FULFILMENT.md#1-cart)) | Plan | G2-06 |
| DOM-quote | Quote components ([ORDERS §2](domains/ORDERS_AND_FULFILMENT.md#2-quote-the-price-breakdown-shown-to-the-customer)) | Plan | G2-05, G2-12 |
| DOM-slots | Slot rules + holds ([ORDERS §3](domains/ORDERS_AND_FULFILMENT.md#3-slots-pickup-windows)) | Plan | G4-01, G4-02, G4-03 |
| DOM-states | Order state machine ([ORDERS §4](domains/ORDERS_AND_FULFILMENT.md#4-order-state-machine)) | Plan | G2-09 |
| DOM-accept | Acceptance + escalation ([ORDERS §5](domains/ORDERS_AND_FULFILMENT.md#5-merchant-acceptance)) | Plan | G4-07 |
| DOM-pick | Picking, scanning, replacements ([ORDERS §6](domains/ORDERS_AND_FULFILMENT.md#6-picking-weighing-and-substitutions)) | Plan | G4-08 … G4-13 |
| DOM-handover | Handover, no-show ([ORDERS §7](domains/ORDERS_AND_FULFILMENT.md#7-handover)) | Plan | G4-14 |
| DOM-cancel | Cancellations ([ORDERS §8](domains/ORDERS_AND_FULFILMENT.md#8-cancellations)) | Plan | G4-15, G5-04 |
| DOM-liability | Liability matrix ([ORDERS §9](domains/ORDERS_AND_FULFILMENT.md#9-liability-matrix)) | Plan | G5-04 |
| DOM-support | Support issues + auto-approval ([ORDERS §10](domains/ORDERS_AND_FULFILMENT.md#10-support-issues)) | Plan | G5-11 |
| DOM-notify | Notification matrix ([ORDERS §11](domains/ORDERS_AND_FULFILMENT.md#11-notifications)) | Plan | G2-14, G4-17 (SMS: OOS) |
| DOM-delivery | Delivery design ([ORDERS §12](domains/ORDERS_AND_FULFILMENT.md#12-delivery-v11-design-notes)) | Stretch | G8-04 |
| DOM-authcapture | Authorise → capture edge cases ([PAYMENTS §3](domains/PAYMENTS_AND_MONEY.md#3-authorise-then-capture)) | Plan | G2-07, G2-10, G4-13 |
| DOM-fee | Fee tiers flat/marginal, snapshots ([PAYMENTS §4](domains/PAYMENTS_AND_MONEY.md#4-platform-fee)) | Plan | G2-05 |
| DOM-hst | HST per line ([PAYMENTS §5](domains/PAYMENTS_AND_MONEY.md#5-sales-tax-hst)) | Plan | G2-05; HST-number validation, Part XX, platform collection: OOS |
| DOM-refunds | Refund mechanics ([PAYMENTS §6](domains/PAYMENTS_AND_MONEY.md#6-refunds)) | Plan | G5-04 |
| DOM-disputes | Disputes ([PAYMENTS §7](domains/PAYMENTS_AND_MONEY.md#7-disputes-chargebacks)) | Plan | G5-06 |
| DOM-payouts | Payouts ([PAYMENTS §8](domains/PAYMENTS_AND_MONEY.md#8-payouts)) | Plan | G5-07 |
| DOM-ledger | Double-entry ledger ([PAYMENTS §9](domains/PAYMENTS_AND_MONEY.md#9-ledger)) | Plan | G2-10 |
| DOM-recon | Reconciliation + statements ([PAYMENTS §10](domains/PAYMENTS_AND_MONEY.md#10-reconciliation-and-close)) | Plan | G5-05, G5-08 |
| DOM-stripecfg | Stripe account configuration ([PAYMENTS §11](domains/PAYMENTS_AND_MONEY.md#11-stripe-account-configuration-checklist)) | Plan | G2-07, G2-08 (test mode); live config: OOS |

## 7. Security ([SECURITY_AND_COMPLIANCE](SECURITY_AND_COMPLIANCE.md))

| Req | Requirement | Disposition | Work items |
|---|---|---|---|
| T1 | Forged webhooks | Plan | G2-08 |
| T2 | Account takeover | Plan | G5-12, G2-16, G2-20 |
| T3 | Client price tampering | Plan | G1-07, G2-05 |
| T4 | Fake weights | Plan | G4-09 |
| T5 | SQL injection | Plan | G1-09, G1-05 (lint rule) |
| T6 | Repudiation | Plan | G5-09 |
| T7 | IDOR / cross-tenant reads | Plan | G1-16, G4-05 |
| T8 | Secrets in git | Plan | G0-03, G1-02 |
| T9 | Verbose errors | Plan | G1-11 |
| T10 | PII in logs | Plan | G1-11 |
| T11 | Checkout spam, slot hoarding | Plan | G2-16, G4-02 |
| T12 | Card testing | Plan | G2-16, G6-09 (Radar rules: OOS) |
| T13 | Customer calls admin API | Plan | G1-06, G1-16 |
| T14 | Payout bank changes | Plan | G5-02 (Stripe-hosted flows) |
| T15 | Supply-chain packages | Plan | G1-14 |
| T16 | Refund abuse by staff | Plan | G5-04 |
| T17 | Poisoned upstream feed | Plan | G3-05 |
| SEC-01 | Auth guard on admin routes | Plan | G1-06 |
| SEC-02 | Server-side pricing | Plan | G1-07 |
| SEC-03 | Externalise credentials + gitleaks | Plan | G1-02, G0-03 |
| SEC-04 | Test fixtures out of runtime | Plan | G1-10 |
| SEC-05 | SQL allow-list | Plan | G1-09 |
| SEC-06 | zod everywhere | Plan | G1-08 |
| SEC-07 | Webhook verification + event store | Plan | G2-08 |
| SEC-08 | Rate limits + Radar | Plan | G2-16 (Radar: OOS) |
| SEC-09 | Staff MFA | Plan | G5-12 |
| SEC-10 | Security headers/CSP | Plan | G6-01 |
| SEC-11 | Audit log | Plan | G5-09 |
| SEC-12 | Penetration test | OOS | replaced by G6-02 (ZAP) + CodeQL (G1-14) |
| SEC-privacy | Retention, export, deletion | Plan | G5-16, G5-17 |
| SEC-legal | PIPEDA/CASL/CPA/Part XX/GST-HST platform obligations | OOS | documented in [SECURITY §7.2](SECURITY_AND_COMPLIANCE.md#72-obligations-canadaontario-to-be-confirmed-by-counsel) |

## 8. Operations ([OPERATIONS](OPERATIONS.md))

| Req | Requirement | Disposition | Work items |
|---|---|---|---|
| OPS-logs | Structured logs + redaction | Plan | G1-11 |
| OPS-tracing | Tracing | Plan | G6-08 |
| OPS-dash | Metrics dashboards | Plan | G5-18 |
| OPS-alerts | Alert rules ([OPERATIONS §3](OPERATIONS.md#3-alerting)) | Plan | G6-09 |
| OPS-slo | SLOs, on-call, incident process, status page | OOS | no production |
| OPS-dr | Backups, PITR, DR drills | OOS | restore procedure documented in G7-07 |
| OPS-cost | Running-cost model | OOS | design exploration only |
| OPS-support | Support tooling and hours | OOS | in-app support flow is G5-11 |
| RB-01 | Runbook: local setup | Plan | G7-01 |
| RB-02 | Runbook: deploy and roll back | OOS | no production |
| RB-03 | Runbook: replay a webhook | Plan | G7-07 |
| RB-04 | Runbook: capture failed | Plan | G7-07 |
| RB-05 | Runbook: authorisation about to expire | Plan | G7-07 |
| RB-06 | Runbook: merchant restricted | Plan | G7-07 |
| RB-07 | Runbook: payout failed | Plan | G7-07 |
| RB-08 | Runbook: dispute received | Plan | G7-07 |
| RB-09 | Runbook: reconciliation mismatch | Plan | G7-07 |
| RB-10 | Runbook: ingest anomaly held | Plan | G7-07 |
| RB-11 | Runbook: search index rebuild | Plan | G7-07 |
| RB-12 | Runbook: pause merchant / disable checkout | Plan | G7-07 |
| RB-13 | Runbook: rotate secrets | Plan | G7-07 |
| RB-14 | Runbook: restore the database | Plan | G7-07 |
| RB-15 | Runbook: product recall | Backlog | recall tool is Backlog |
| RB-16 | Runbook: privacy request | Plan | G7-07 |

## 9. Testing ([TESTING §3](TESTING.md#3-mandatory-test-cases))

| Req | Test area | Disposition | Work items |
|---|---|---|---|
| TST-3.1 | Fee calculation | Plan | G1-15, G2-05 |
| TST-3.2 | Pricing / quote + golden test | Plan | G2-05 |
| TST-3.3 | Checkout and payments | Plan | G2-17, G4-13 |
| TST-3.4 | Webhooks | Plan | G2-08 |
| TST-3.5 | Order state machine | Plan | G2-09 |
| TST-3.6 | Authorisation matrix | Plan | G1-16 |
| TST-3.7 | Catalogue ingest | Plan | G3-04, G3-05, G3-06 |
| TST-3.8 | E2E journeys 1–8 | Plan | G4-18 (1–6), G5-19 (7–8) |
| TST-contract | Contract tests | Plan | G2-18 |
| TST-a11y | Accessibility | Plan | G6-04 |
| TST-load | Load tests | Plan | G6-06 |
| TST-resilience | Resilience | Plan | G6-05 |
| TST-coverage | Coverage gates | Plan | G6-03 |
| TST-data | Test data | Plan | G1-13 |
| TST-uat | UAT with merchant staff; pilot | OOS | no real merchant |

## 10. Features ([FEATURE_ROADMAP §2](product/FEATURE_ROADMAP.md#2-feature-map))

| Req | Feature | Disposition | Work items |
|---|---|---|---|
| F-dietary | Dietary and allergen filters | Plan | G3-09 |
| F-specials | Specials page + sale badges | Plan | G3-13, G3-10 |
| F-unitprice | Unit-price display | Plan | G3-10 |
| F-avgweight | Weighed-item estimates from avgWeight | Plan | G3-04 |
| F-fbt | Frequently bought together | Backlog | |
| F-minorder | Minimum-order progress / small-basket fee | Plan | G2-12 (minimum order; no small-basket fee: drip-pricing rules) |
| F-recipes | Recipe / bundle pages | Backlog | |
| F-nlsearch | Natural-language search | Backlog | |
| F-buyagain | Buy again | Plan | G4-19 |
| F-lists | Favourites / shopping lists | Backlog | |
| F-reorder | Reorder | Plan | G4-19 |
| F-backinstock | Back-in-stock notifications | Backlog | |
| F-addtoorder | Add items to an existing order | Stretch | G8-01 |
| F-savedcards | Saved cards | Stretch | G8-07 |
| F-recurring | Recurring orders | Backlog | |
| F-loyalty | Loyalty points | Won't | |
| F-loyalty-int | Merchant loyalty integration | OOS | needs a real merchant |
| F-slotpricing | Slot pricing and passes | Backlog | |
| F-imhere | "I'm here" check-in | Plan | G4-14 |
| F-altpickup | Pickup by someone else | Plan | G4-14 |
| F-eta | Live status + ETA | Backlog | |
| F-lockers | Pickup lockers | Won't | hardware |
| F-labels | Bag labels / pick slips | Plan | G4-16 |
| F-catsoldout | Category sold out today | Plan | G4-20 |
| F-scanning | Barcode + deli-label scanning | Plan | G4-10, G4-11 |
| F-pickpath | Pick-path ordering | Backlog | |
| F-throttle | Automatic slot throttling | Backlog | |
| F-m-analytics | Merchant analytics | Plan | G5-13, G5-18 (basic); advanced: Backlog |
| F-multipicker | Multi-picker orders | Backlog | |
| F-pos | POS integrations | Backlog | |
| F-csv | CSV catalogue import | Backlog | |
| F-express | Express / embedded onboarding | Plan | G5-02 |
| F-selfserve | Merchant self-serve application | Backlog | |
| F-enrich | AI catalogue enrichment | Backlog | |
| F-m-promos | Merchant-funded promotions | Stretch | G8-03 |
| F-feeschedules | Configurable fee schedules | Plan | G2-05 |
| F-smallbasket | Small-basket fee | Won't | drip-pricing rules; minimum order instead |
| F-credit | Store credit | Stretch | G8-05 |
| F-promocodes | Promo codes + funding model | Stretch | G8-03 |
| F-giftcards | Gift cards | Won't | |
| F-membership | Paid membership | Backlog | |
| F-sponsored | Sponsored products | Backlog | |
| F-rating | Order rating | Plan | G4-19 |
| F-recall | Product recall tool | Backlog | |
| F-quality | Merchant quality score | Backlog | |
| F-fraud | Device fingerprinting / refund-abuse scoring | Backlog | |
| F-reviews | Product reviews | Won't | |
| F-seo | SEO foundations | Plan | G3-16 |
| F-weekly | Weekly specials email | Backlog | |
| F-abandoned | Abandoned-cart reminder | Backlog | |
| F-referral | Referral programme | Backlog | |
| F-waitlist | Waitlist pages | Backlog | |
| F-analytics | Product analytics with consent | OOS | no real users; metrics page G5-18 instead |
| F-dashboard | Metrics dashboard | Plan | G5-18 |
| F-ab | A/B testing | Backlog | |
| F-dwh | Data warehouse | Backlog | |
| F-viewas | View as customer (support) | Backlog | |
| F-bulk | Bulk support tools | Backlog | |
| F-llm-support | LLM support reply drafting | Backlog | |
| F-preorders | Holiday pre-orders | Stretch | G8-02 |
| F-catering | Catering / office lunch | Backlog | discovery first |
| F-multimerchant | Second merchant + location picker | Stretch | G8-06 |
| F-locations | Multi-location data model | Plan | G1-04 |
| F-consent | Marketing email consent capture (CASL) | OOS | no marketing email in the reference implementation |
| F-delivery | Delivery via courier API | Stretch | G8-04 (mock courier adapter) |

---

## Coverage summary

Generated counts are printed by `node docs/tools/check-docs.mjs`. At v1.0 of this matrix, **every requirement has a disposition**. None is left unmapped.
