# ADR-0008: Background jobs with pg-boss and a transactional outbox

- Status: Accepted, amended 2026-09-27 (G2-03)
- Date: 2026-09-27

## Context
There's no background processing today: everything runs inside HTTP requests. We need retries (webhooks, captures, notifications), schedules (auto-reject, auth-expiry guard, reconciliation, slot generation), and guaranteed side effects after DB commits.

## Decision
- **pg-boss** (a Postgres-backed queue) in schema `pgboss`, consumed by the **worker** process. No Redis/SQS needed at our scale, and jobs share Postgres backups.
- **Transactional outbox** (`ops.outbox`): state changes and their outbound events are committed atomically; a relay moves them to queues.
- Consumers are idempotent (natural keys / Stripe idempotency keys); failed jobs retry with exponential backoff, then go to a dead-letter queue with an alert.

## Alternatives
- Payload Jobs Queue: viable, but ties domain jobs to the CMS and has less control over retries/DLQ. Possible to adopt later if Payload's jobs mature.
- BullMQ + Redis / SQS: more moving parts for no current benefit.
- Inngest/Trigger.dev (hosted): good developer experience; another vendor holding money workflows. Reconsider if we go fully serverless.

## Amendment (2026-09-27, G2-03): an in-house Postgres queue instead of pg-boss
Built as `ops.jobs` (migration 005) plus `src/modules/ops/jobs.ts` (~120 lines), keeping every principle above: Postgres-backed, `FOR UPDATE SKIP LOCKED` consumers, exponential backoff with jitter, a `dead` status as the dead-letter queue with an `onDead` hook and an alert.

Why not pg-boss:
- pg-boss creates and migrates its own schema at startup, so the app role would need DDL rights. The least-privilege design (ADR-0004) gives `app_rw` none. Our table is created by a normal migration.
- Jobs are enqueued **in the caller's transaction** (same database, same connection). The outbox relay therefore publishes each event exactly once: it inserts the jobs and marks the event published in one transaction.
- The job table is small and visible to SQL, reconciliation and tests. There's no second migration system to keep in step.

Consumers are still idempotent: `ops.processed_events` records (consumer, event) inside the consumer's own transaction. Revisit pg-boss (or Payload Jobs) if we need features such as throttling or cron with timezone rules.

