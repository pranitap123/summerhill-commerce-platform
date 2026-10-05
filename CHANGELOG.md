# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Work item IDs (`G2-07`) refer to [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## [1.0.0] - unreleased

The first complete release: a grocery marketplace reference implementation that runs locally with one command, on synthetic data and in Stripe test mode (or with the built-in payment simulator). The version is tagged when the repository is published (see the plan's pre-publish checklist).

### Added

- **Foundations (G1):** one-command local stack (Postgres 16, Elasticsearch 9, Mailpit, Stripe CLI) in Docker Compose; forward-only SQL migrations with checksums; five Postgres schemas with least-privilege roles (the ledger is INSERT-only); validated configuration that refuses live Stripe keys; a modular monolith with lint-enforced module boundaries; the standard error envelope, request ids and structured logs; a deterministic synthetic catalogue (219 products) and demo users for every role; `npm run ci:local`.
- **Orders and payments (G2):** a cart with server-side quotes (weights, promotions, HST, deposits); Stripe Connect destination charges with a card **hold at checkout** and **capture of the final amount after picking**; a tiered platform fee; an order state machine with a timeline; webhooks stored and processed by a worker (transactional outbox, Postgres job queue, retries, dead letters); idempotency keys on every money call; a double-entry ledger; the authorisation-expiry guard; transactional email.
- **Catalogue and search (G3):** an ingestion pipeline in Python/Dagster with connectors, data-quality rules and an **anomaly guard that holds suspicious runs**; the full product model (weights, comparison unit prices, deposits, tax codes); search v2 on Elasticsearch with synonyms, typo tolerance, facets and a Postgres full-text fallback; zero-downtime index rebuilds with an alias swap; storefront v2.
- **Fulfilment (G4):** pickup slots with capacity, lead time and closures; a tablet-first **merchant console**: accept (auto-reject after 15 minutes), pick with barcode scanning and deli-scale labels, weigh, mark unavailable, **replace** with customer approval, complete (capture), hand over with a 6-digit pickup code; pick slips; a **payment simulator** that runs every flow with Stripe's test cards, including 3-D Secure, without a Stripe account; Playwright journeys.
- **Back office and finance (G5):** the `/ops` console by role; refunds by the liability matrix with a support limit; disputes with an evidence pack; payouts with four-eyes approval above CA$5,000; **daily reconciliation** against Stripe balance transactions plus six invariants; monthly statements and close export; merchant lifecycle (onboarding, go live, pause, offboard); support issues with automatic small refunds; staff MFA (TOTP); users and roles; feature flags; privacy export and deletion; retention purge; audit log; metrics.
- **Quality, security and observability (G6):** CSP with per-request nonces and security headers (local Observatory rules A+); CSRF origin checks; an OWASP ZAP baseline (0 High); coverage gates (money and state machine at 100%); axe accessibility checks (0 serious) and a keyboard-only checkout; one outbound-call guard with timeouts, retries with jitter and circuit breakers; resilience tests; k6 and Lighthouse budgets; OpenTelemetry tracing across request → webhook → job; alert rules as code.
- **Documentation, demo and runbooks (G7):** a rewritten README with screenshots and a GIF of the fulfilment journey; a 5-minute [demo script](docs/DEMO.md) and its recording (`tests/e2e/demo.spec.ts`); [runbooks](docs/runbooks/) for every alert; the `npm run ops` command for operators (`alerts`, `jobs:dead`, `webhook:replay`, `capture:retry`, `mfa:reencrypt`).

### Changed

- Demo products show real photos instead of the placeholder: 71 public-domain/CC0 images from Wikimedia Commons, one per kind of food (480 px WebP, about 2 MB), listed with author and licence in `public/product-images/CREDITS.md`. No merchant images. Table cream and ginger ale still use the placeholder: no public-domain photo without a brand label was found.
- An order whose capture failed (`payment_issue`) can now be captured again (`capture:retry`, RB-04), with the same idempotency key.
- Alerts link to their specific runbook instead of a generic list.

### Fixed

- Rotating `PAYLOAD_SECRET` no longer locks staff out of two-step verification: `npm run ops -- mfa:reencrypt` re-seals the stored TOTP secrets with the new key (RB-13).
- End-to-end runs on Windows no longer leave their worker process running after the run.
- Export links in `/ops` (monthly close CSV, merchant statements) are plain downloads: as page links they were prefetched on every view, building the export in the background, and could keep the page from ever settling.
- `webhook:replay` refuses an event the worker is still processing, so an event can't be processed twice at once.

### Security

- Removed a sample file containing a real merchant's sales volumes from the working tree; purging it from git history is on the pre-publish checklist (G0).
- Secret and data scanner as a git hook and over the full history (`npm run scan:history`).

## [0.4.0] - 2026-09 (pre-plan prototype)

Stages 1–4 of the original prototype, superseded by the work above: a scraper feeding Postgres and Elasticsearch, a Payload ecommerce storefront with Stripe Checkout, and a first Stripe Connect integration.

[1.0.0]: https://github.com/pranitap123/summerhill-commerce-platform/releases/tag/v1.0.0
