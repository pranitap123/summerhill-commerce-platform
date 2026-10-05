# Grocery Marketplace: reference implementation

<!-- CI badges are added at publication (pre-publish checklist, step 8), once GitHub Actions has run. -->

> **Disclaimer:** this is an independent demonstration project. It is **not affiliated with, endorsed by or operated on behalf of Summerhill Market** or any other retailer named in it. Payments run in **Stripe test mode** only (or in the built-in payment simulator); no real orders are placed and no real money moves. All catalogue data is **synthetic**. © 2026 Pranita Panchal, all rights reserved (see [LICENSE](LICENSE)).

A grocery marketplace where a local store sells through the platform, built as a professional reference implementation. The hard part of online grocery is money: **the customer pays for what was actually packed**, not what was ordered. Bananas weigh more or less than estimated, an item is out of stock, a replacement costs more. This project places a **card hold at checkout, lets the store pick, weigh and replace, then captures exactly the final amount**, splits it between the merchant and the platform, and **reconciles every cent** against Stripe.

![The store picks an order: scan, weigh with a deli label, replace, complete (capture), hand over](docs/media/fulfilment.gif)

## What it does

| Area | Highlights |
|---|---|
| **Storefront** | Search with synonyms and typo tolerance (Elasticsearch, Postgres fallback), categories, unit prices, weighed items, HST and bottle deposits, pickup slots, guest checkout, order tracking, replacement approval, "report a problem" |
| **Payments** | Stripe Connect destination charges; **hold at checkout, capture after picking** (idempotent, retried safely); tiered platform fee; refunds by a liability matrix; disputes with an evidence pack; payouts with four-eyes approval; a double-entry ledger |
| **Merchant console** | Tablet-first: accept (auto-reject after 15 min), pick with barcode scanning and deli-scale labels, weigh, mark unavailable, replace, complete, hand over with a pickup code; hours, capacity, closures |
| **Back office** (`/ops`) | Orders, refunds, disputes, payouts, **daily reconciliation**, statements, merchant onboarding and lifecycle, catalogue review, users and roles, feature flags, privacy requests, audit log, metrics; staff sign in with MFA |
| **Catalogue pipeline** | Python/Dagster ingestion with connectors, data-quality rules and an **anomaly guard** that holds suspicious runs for review |
| **Operations** | Transactional outbox and a Postgres job queue; alerts as code, each with a [runbook](docs/runbooks/); OpenTelemetry traces across request → webhook → job; circuit breakers and timeouts on every outbound call |
| **Quality** | Unit, authorisation-matrix, integration (real Postgres) and Playwright tests; money and state machine at 100% branch coverage; CSP A+, OWASP ZAP baseline, axe accessibility checks |

| | |
|---|---|
| ![Search results](docs/media/02-search.png) | ![Cart with pickup time and the hold explained](docs/media/04-cart-hold.png) |
| Search: synthetic catalogue, unit prices | Cart: pickup time, the card hold explained |
| ![Merchant console pick screen](docs/media/07-console-pick.png) | ![Order page after capture](docs/media/08-order-charged.png) |
| Console: scanned, weighed, replaced | Customer: charged the final amount, the rest of the hold released |
| ![Ops order page with refund and ledger](docs/media/09-ops-order-refund.png) | ![Reconciliation run](docs/media/10-ops-reconciliation.png) |
| Back office: a refund split by the liability matrix | Finance: reconciliation catching two charges Stripe (here, the simulator) has no record of |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    SF[Storefront]
    CON[Merchant console]
    OPS[Back office /ops]
  end
  subgraph App["Next.js 16 + Payload 3 (modular monolith)"]
    API[Route handlers<br/>auth policy, zod, idempotency]
    MOD[Modules: catalog, cart, pricing, ordering,<br/>payments, fulfilment, scheduling, payouts,<br/>support, identity, privacy, ops]
  end
  W[Worker<br/>outbox relay, jobs, schedules]
  PG[(Postgres 16<br/>catalog, merchant, commerce,<br/>finance ledger, ops)]
  ES[(Elasticsearch 9)]
  ST[Stripe Connect<br/>test mode / simulator]
  PL[Catalogue pipeline<br/>Python, Dagster]
  MP[Mailpit]

  SF & CON & OPS --> API --> MOD
  MOD <--> PG
  MOD --> ES
  MOD --> ST
  ST -- webhooks --> API
  PG -- outbox, jobs --> W
  W --> ST & ES & MP
  PL --> PG
```

One codebase, two processes (app and worker), Postgres as the system of record. Every state change that must trigger work writes an outbox event in the same transaction; the worker turns events into jobs (capture, email, search updates) with retries and dead letters. The reasoning is in the [ADRs](docs/adr/) and [SYSTEM_DESIGN](docs/architecture/SYSTEM_DESIGN.md).

## Quick start

Needs **Docker**, **Node 20** (`.nvmrc`) and **Python 3.12+** (`.python-version`). No Stripe account needed: the payment simulator implements Stripe's test cards, including 3-D Secure.

```bash
git config core.hooksPath tools/git-hooks                 # secret/data scanner before commits
npm install && npm install --prefix web/summerhill-commerce
npm run pipeline:install                                  # .venv with the catalogue pipeline
npm run stack:up                                          # Postgres :5433, Elasticsearch :9200, Mailpit :8025
npm run db:setup                                          # migrations + synthetic catalogue (via the pipeline)
cp web/summerhill-commerce/.env.example web/summerhill-commerce/.env   # then set PAYLOAD_SECRET (see the file)
npm run seed:users --prefix web/summerhill-commerce       # demo accounts (below)
npm run search:rebuild --prefix web/summerhill-commerce   # build the search index
npm run dev:sim --prefix web/summerhill-commerce          # http://localhost:3000 with the payment simulator
npm run worker:sim --prefix web/summerhill-commerce       # second terminal: webhooks, captures, emails, schedules
```

Then follow the **[5-minute demo script](docs/DEMO.md)**. Emails appear in Mailpit at http://localhost:8025.

On a slow machine, a production build is faster to click through than the dev server: `npm run build:sim && npm run start:sim` (in `web/summerhill-commerce`).

Upgrading a local database from before G2: run `npm run db:migrate` and `npm run payload:cleanup` once (it removes the old Payload ecommerce tables, which otherwise make Payload's schema sync stop at an interactive prompt). Starting over: `npm run stack:reset`.

### With Stripe test mode

Put an `sk_test_…` key in `.env` (live keys are refused at startup), run `dev:stack` and `worker` instead of the `:sim` variants, and forward webhooks with `npm run stack:up:stripe`; put the printed `whsec_…` secret into `.env` as `STRIPE_WEBHOOKS_SIGNING_SECRET`.

### Test cards

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0027 6000 3184` | Asks for 3-D Secure |
| `4000 0000 0000 0259` | Succeeds, then disputed once captured |

Any future expiry date and any CVC.

### Demo accounts

Created by `npm run seed:users`; addresses and the shared password are in [`web/summerhill-commerce/stack.env`](web/summerhill-commerce/stack.env) (local demo values only).

| Account | Can | Where |
|---|---|---|
| `customer@example.com` | Shop, see orders | Storefront |
| `picker@example.com` | Accept, pick, hand over | `/console` |
| `owner@example.com` | Picker's work plus store settings | `/console` → Settings |
| `support@example.com` | Orders, refunds up to $50, support issues | `/ops` |
| `finance@example.com` | Payouts, reconciliation, disputes, statements | `/ops` |
| `admin@example.com` | Everything, incl. merchants, catalogue, users, flags, privacy | `/ops`, Payload at `/admin` |

**Staff sign in with a second factor.** After the password, enter the 6-digit code from `npm run demo:totp --prefix web/summerhill-commerce` (or add `DEMO_TOTP_SECRET` from stack.env to an authenticator app).

### More to try

- **Catalogue pipeline:** `npm run pipeline:ingest` runs one ingest; `CATALOG_FIXTURE_FRACTION=0.5 npm run pipeline:ingest` makes the anomaly guard hold the run for review in `/ops/catalog` ([pipeline/README.md](pipeline/README.md)). `npm run pipeline:dagster` opens the Dagster UI with the schedules on http://localhost:3070.
- **Traces:** `npm run stack:observability` starts Jaeger (http://localhost:16686); run the app with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and follow one checkout from request to webhook to capture.
- **Operator commands:** `npm run ops --prefix web/summerhill-commerce -- alerts` (and `jobs:dead`, `webhook:replay`, `capture:retry`, `mfa:reencrypt`), used by the [runbooks](docs/runbooks/).

## Checks

```bash
npm run ci:local     # everything CI runs: scans, docs, format, lint, typecheck, unit, authz, integration, coverage, audit (needs the stack)
npm run ci:fast      # without integration tests and the audit (no Docker)
npm run test:e2e --prefix web/summerhill-commerce   # browser journeys (payment simulator); PW_CHANNEL=chrome to use an installed Chrome
npm run scan:security                               # security headers + OWASP ZAP baseline against the running app
```

Results of the quality, security and performance checks are in [TESTING §2.1](docs/TESTING.md#21-quality-security-and-performance-results-g6-2026-09-28). See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the Definition of Done.

## Documentation

Start with the **[documentation index](docs/README.md)**. The most useful entry points:

| Doc | What it covers |
|---|---|
| [docs/DEMO.md](docs/DEMO.md) | The 5-minute walkthrough |
| [docs/architecture/SYSTEM_DESIGN.md](docs/architecture/SYSTEM_DESIGN.md) | Architecture, modules, data, jobs, integrations |
| [docs/domains/PAYMENTS_AND_MONEY.md](docs/domains/PAYMENTS_AND_MONEY.md) | Holds, capture, fees, refunds, disputes, ledger, reconciliation |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/runbooks/](docs/runbooks/) | What to do when an alert fires |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Every work item with acceptance criteria, and what was built |
| [CHANGELOG.md](CHANGELOG.md) | Releases |

## Repository layout

```
db/                   forward-only migrations (checksums, advisory lock), synthetic seed, Payload cleanup
docs/                 design, ADRs, runbooks, plan, traceability, openapi.yaml (generated), media
infra/                docker compose stack (Postgres, Elasticsearch, Mailpit, Stripe CLI, ZAP, k6, Jaeger)
pipeline/             catalogue ingestion (Python, Dagster): connectors, quality rules, anomaly guard
tools/                ci-local runner, secret/data scanner, git hooks, security scans
web/summerhill-commerce/   Next.js 16 + Payload 3 app
  src/modules/        one folder per module; its public API is its index.ts (boundaries enforced by lint)
  src/worker/         worker process: outbox relay, job queue, schedules
  src/server/         config, db, route wrapper (auth policy, validation, errors), logging, tracing, security headers
  src/app/            storefront, (console) merchant console, (ops) back office, api
  src/scripts/        seed users, search rebuild, ops commands
  tests/              unit, authz matrix, integration (real Postgres), e2e (Playwright)
dagster/, scripts/    legacy prototype scripts (stages 1–2), superseded by pipeline/
```

## Security

See [SECURITY.md](SECURITY.md). Third-party licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
