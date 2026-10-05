# RB-14 Restore the database

When: data loss or corruption (a bad migration, a destructive manual query, a lost volume).

Postgres is the system of record (ADR-0004): orders, payments, the ledger, the catalogue, and the ops tables (jobs, outbox, webhook events, audit). Elasticsearch is rebuilt from it; Stripe holds its own copy of every money movement, which is how the gap after a restore is closed.

Target in production ([SECURITY §8](../SECURITY_AND_COMPLIANCE.md#8-infrastructure-security), [OPERATIONS §7](../OPERATIONS.md#7-disaster-recovery-and-continuity)): point-in-time recovery for 7 days plus daily snapshots for 30 days, RPO ≤ 5 min, RTO ≤ 1 h. The local stack has neither, so it uses `pg_dump`.

## 1. Stop writes

Turn `checkout.enabled` off ([RB-12](RB-12-kill-switches.md)), stop the worker, then the app. Stripe keeps retrying webhooks for 3 days, so nothing is lost while we're down.

## 2. Restore

**Managed Postgres:** restore to a point in time just before the incident, as a **new** instance; check it; then point the app at it.

**Local stack** (from a dump):

```bash
# backup (do this before risky work)
docker exec grocery-postgres pg_dump -U grocery_admin -Fc grocery > grocery.dump
# restore into a scratch database first, and check it
docker exec grocery-postgres createdb -U grocery_admin grocery_restore
docker exec -i grocery-postgres pg_restore -U grocery_admin -d grocery_restore --no-owner < grocery.dump
```

Check the restored copy: row counts of `commerce.orders`, `finance.payments`, `finance.ledger_journals`, `catalog.products`, `ops.audit_log`; and every migration applied (`MIGRATION_DATABASE_URL=<…>/grocery_restore npm run db:status`). Then swap it in (rename the databases, or change `CATALOG_DATABASE_URL`). The Payload database (`payload`: users, pages) is dumped and restored the same way.

## 3. Close the gap with Stripe

Everything Stripe did after the restore point has to be replayed:

1. List the events since the restore point: Stripe dashboard → Developers → Events, or `stripe events list --created.gte <unix time>` (platform and each connected account).
2. Re-send them (`stripe events resend evt_…`, see [RB-03](RB-03-webhook-replay.md)). They are stored and processed as usual; duplicates are ignored.
3. Run reconciliation for each affected day ([RB-09](RB-09-reconciliation-mismatch.md)): it lists every Stripe transaction we still don't have.

Orders placed and picked after the restore point may exist only in Stripe (the PaymentIntent) and at the store. Reconciliation shows them; contact those customers.

## 4. Restart

Re-apply privacy deletions made since the restore point ([RB-16](RB-16-privacy-request.md)). Start the app and worker, rebuild search ([RB-11](RB-11-search-rebuild.md)), turn checkout back on, watch alerts.

Walked through 2026-09-29 on the local stack (steps 2 and the checks): `pg_dump` of `grocery` (0.5 MB), restored into the scratch database `grocery_restore`; orders, payments, ledger journals, products and audit rows matched (62 / 62 / 9 / 219 / 8), `db:status` showed all 9 migrations applied; scratch database dropped. Steps 1, 3 and 4 were not rehearsed (no production, no Stripe events to replay).
