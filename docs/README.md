# Documentation index

Updated 2026-09-29 · Parent: [README](../README.md)

This project is a reference implementation published on GitHub, not a business (scope decision 2026-09-27). The documents fall into three groups:

- **Current**: describes the system as built. If the code disagrees, that's a bug in one of them.
- **Design + current**: design documents whose technical parts are built; their business and launch parts (pilot, pricing to merchants, staffing) are design exploration.
- **Design exploration**: the market, business and launch thinking behind the design. Kept because it explains *why* the system works this way; not a commitment.

## Start here

| Doc | Group | What it covers |
|---|---|---|
| [README](../README.md) | Current | What it is, quick start, demo accounts, test cards |
| [DEMO](DEMO.md) | Current | The 5-minute walkthrough and how it's recorded |
| [CHANGELOG](../CHANGELOG.md) | Current | Releases |
| [CONTRIBUTING](../CONTRIBUTING.md) | Current | Conventions, Definition of Done, checks |

## Architecture and domains

| Doc | Group | What it covers |
|---|---|---|
| [architecture/SYSTEM_DESIGN](architecture/SYSTEM_DESIGN.md) | Design + current | Architecture, modules, data model, jobs, integrations |
| [architecture/CURRENT_STATE](architecture/CURRENT_STATE.md) | Historical | The prototype as reviewed on 2026-09-27, before G1; the gaps it lists are closed |
| [domains/PAYMENTS_AND_MONEY](domains/PAYMENTS_AND_MONEY.md) | Design + current | Charge model, hold and capture, fees, tax, refunds, disputes, payouts, ledger, reconciliation |
| [domains/ORDERS_AND_FULFILMENT](domains/ORDERS_AND_FULFILMENT.md) | Current | Order states, picking, replacements, handover, liability matrix |
| [domains/CATALOG_AND_SEARCH](domains/CATALOG_AND_SEARCH.md) | Current | Catalogue model, ingestion, anomaly guard, search |
| [adr/](adr/) | Current | Decision records 0001–0012 with their status |
| [openapi.yaml](openapi.yaml) | Current | The HTTP API (generated: `npm run openapi --prefix web/summerhill-commerce`) |

## Quality and operations

| Doc | Group | What it covers |
|---|---|---|
| [TESTING](TESTING.md) | Current (§2.1 results) | Test strategy, coverage gates, G6 results |
| [SECURITY_AND_COMPLIANCE](SECURITY_AND_COMPLIANCE.md) | Design + current | Threat model, controls as built; §7 obligations are for a real launch |
| [OPERATIONS](OPERATIONS.md) | Design + current | Observability, alerts and runbooks as built; SLOs, on-call, costs are for a real launch |
| [runbooks/](runbooks/README.md) | Current | What to do when an alert fires, walked through on the local stack |
| [SECURITY.md](../SECURITY.md) | Current | Reporting vulnerabilities |

## Planning

| Doc | Group | What it covers |
|---|---|---|
| [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) | Current | Phases G0–G8, work items, what was built and why it deviated |
| [TRACEABILITY](TRACEABILITY.md) | Current | Every requirement mapped to a work item or a decision (`node docs/tools/check-docs.mjs`) |
| [BLUEPRINT](BLUEPRINT.md) | Design exploration | Research, strategy, decisions; the master document |
| [product/PRD](product/PRD.md) | Design exploration | Product requirements for a real launch |
| [product/FEATURE_ROADMAP](product/FEATURE_ROADMAP.md) | Design exploration | Feature scoring and what we deliberately don't build |
| [DELIVERY_PLAN](DELIVERY_PLAN.md) | Superseded | The original startup launch plan, replaced by IMPLEMENTATION_PLAN |
