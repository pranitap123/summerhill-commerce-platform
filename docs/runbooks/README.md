# Runbooks

Status: v1.0 · Updated 2026-09-29 · Parent: [OPERATIONS](../OPERATIONS.md)

Step-by-step procedures for a **self-hosted** deployment of this demo (G7-07). Every alert the system raises names its runbook (`src/modules/ops/alertRules.ts`), so the page you land on from an alert email is one of these.

Commands assume the local compose stack and are run from the repository root; `npm run … --prefix web/summerhill-commerce` is shortened to **`app:`** below, e.g. `app: npm run ops -- alerts`. In a real deployment, run the same commands in a one-off container of the app image with production settings.

| ID | Runbook | Alert kinds | Walked through |
|---|---|---|---|
| RB-01 | Local setup from zero | n/a | [README § Quick start](../../README.md#quick-start) |
| [RB-03](RB-03-webhook-replay.md) | Replay a Stripe webhook | `webhook.failed`, `webhook.lagging`, `job.dead` | 2026-09-29 (integration test + CLI) |
| [RB-04](RB-04-capture-failed.md) | Capture failed | `capture.failed`, `capture.shortfall` | 2026-09-29 (integration test + CLI) |
| [RB-05](RB-05-auth-expiring.md) | Authorisation about to expire | `payment.auth_expiring`, `payment.authorization_canceled`, `payment.late_authorization` | 2026-09-29 (read-through against code) |
| [RB-06](RB-06-merchant-restricted.md) | Merchant restricted / requirements due | (Connect `account.updated`) | 2026-09-29 (read-through + integration suite) |
| [RB-07](RB-07-payout-failed.md) | Payout failed | `payout.failed` | 2026-09-29 (read-through against code) |
| [RB-08](RB-08-dispute.md) | Dispute received | `dispute.created`, `dispute.due_soon`, `dispute.lost` | 2026-09-29 (read-through; E2E journey from G5) |
| [RB-09](RB-09-reconciliation-mismatch.md) | Reconciliation mismatch | `recon.mismatch`, `recon.failed` | 2026-09-29 (local stack) |
| [RB-10](RB-10-ingest-held.md) | Ingest anomaly held | `ingest.held` | 2026-09-29 (local stack) |
| [RB-11](RB-11-search-rebuild.md) | Search index rebuild | (search falls back to Postgres) | 2026-09-29 (local stack) |
| [RB-12](RB-12-kill-switches.md) | Pause a merchant / disable checkout | `payments.card_testing`, any SEV1 | 2026-09-29 (integration suite) |
| [RB-13](RB-13-rotate-secrets.md) | Rotate secrets | n/a (scheduled, or after a leak) | 2026-09-29 (local stack: `PAYLOAD_SECRET`; others read-through) |
| [RB-14](RB-14-restore-database.md) | Restore the database | n/a | 2026-09-29 (local stack: dump and restore into a scratch database) |
| [RB-16](RB-16-privacy-request.md) | Data subject access / deletion | n/a | 2026-09-29 (integration suite) |

Not written, by decision: RB-02 deploy and roll back (no production, see [TRACEABILITY](../TRACEABILITY.md)); RB-15 product recall (the recall tool is Backlog). Alert kinds without their own page (`order.unaccepted`, `slot.overbooked`, `refund.failed`) point to the [index of alerts in OPERATIONS §3](../OPERATIONS.md#3-alerting).

## Conventions

- **Mitigate first, then fix.** Each runbook starts with how to stop the damage, then how to find the cause.
- **Every change is audited.** The `/ops` console records the signed-in staff member; the `ops` CLI needs `--by <name>`. Don't change money or order state with SQL: the ledger, the order timeline and the audit log would disagree.
- **Read-only SQL is fine.** `docker exec -it grocery-postgres psql -U grocery_admin grocery` opens a shell on the local database.
- **Close the alert** when done: `/ops` → the alert → Resolve (or `POST /api/admin/alerts/{id}/resolve`).

## Tools used by the runbooks

| Tool | What it does |
|---|---|
| `/ops` | Operations console: orders, refunds, disputes, payouts, reconciliation, catalogue, users, flags, privacy, audit log |
| `app: npm run ops -- alerts` | Open alerts |
| `app: npm run ops -- jobs:dead` | Dead-lettered jobs with their last error |
| `app: npm run ops -- webhook:replay <evt_…> --by <name>` | RB-03 |
| `app: npm run ops -- capture:retry <order> --by <name>` | RB-04 |
| `npm run pipeline:runs` / `node tools/pipeline.mjs approve <id> --by <name>` | RB-10 |
| `app: npm run search:rebuild` | RB-11 |
