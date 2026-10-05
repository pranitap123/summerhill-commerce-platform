# ADR-0002: Modular monolith on Next.js + Payload, with a separate worker

- Status: Accepted, implemented (G1-05: modules under `src/modules/*`, boundaries enforced by lint; app and worker processes from one codebase, G2-03)
- Date: 2026-09-27

## Context
Two engineers, ~3k SKUs, < 1k orders/day expected in year one. We need strong internal boundaries (payments must not be tangled with UI code) but can't afford the operational cost of microservices.

## Decision
- One repository and one application codebase (Next.js App Router + Payload 3) organised into modules under `src/modules/*`, with boundaries enforced by `eslint-plugin-boundaries`.
- Two runtime processes from the same code: **app** (HTTP) and **worker** (jobs/cron).
- The ingest pipeline stays in Python/Dagster as a separate deployable.

## Consequences
- \+ Simple deploys, shared types, one database transaction across modules when needed.
- \+ A module can be extracted later if a real scaling or team-ownership need appears.
- − Discipline is needed to keep the boundaries; lint rules and reviews enforce them.

## Alternatives
- Microservices (orders, payments, catalogue): rejected; distributed transactions and ops overhead at our size.
- Separate backend (NestJS/FastAPI) + Next frontend: rejected for now; it duplicates auth and types and doesn't solve a current problem.
