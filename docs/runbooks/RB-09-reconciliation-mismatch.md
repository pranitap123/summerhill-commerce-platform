# RB-09 Reconciliation mismatch

Alerts: `recon.mismatch` (SEV2, the daily run found at least one difference), `recon.failed` (SEV2, the run itself errored).

## How reconciliation works

Every day at 06:00 (America/Toronto) the `recon.daily` job reconciles the previous business day ([PAYMENTS_AND_MONEY](../domains/PAYMENTS_AND_MONEY.md), `src/modules/payouts/reconciliation.ts`):

1. **Stripe → us:** each balance transaction (charge, refund, dispute adjustment) is matched by id to our payment, refund or dispute; amount and Stripe fee must agree to the cent.
2. **Us → Stripe:** captured payments and succeeded refunds of the day that Stripe doesn't show.
3. **Invariants over all orders:** capture split, line totals, balanced ledger, no ready order without a capture, no capture without picking, refunds within the capture.

Any difference > 0¢ becomes an item, and the run raises one alert.

## 1. Look at the run

`/ops/reconciliation` → the run → items. Each item has a kind, the check, the order, the reference (Stripe id), expected and actual amounts.

| Item kind | Usual cause | What to do |
|---|---|---|
| `unmatched_stripe` | Stripe has a transaction we don't: a webhook never arrived or failed | [RB-03](RB-03-webhook-replay.md) for the event, then re-run |
| `missing_in_stripe` | We recorded a capture/refund Stripe doesn't show for that day | Usually a day boundary (captured 23:59, settled 00:00): re-run the next day. Otherwise check the PaymentIntent in Stripe |
| `amount_mismatch` | Amounts or fees differ | Compare with the Stripe balance transaction; a Stripe fee unknown at capture is posted by the run itself, so a remaining difference is a bug |
| `invariant` | Our own data is inconsistent | A bug. Open the order's ledger in `/ops/orders/{order}`; never "fix" the ledger with SQL, post a correcting journal through code |

## 2. Fix and re-run

Fix the cause, then re-run the day from `/ops/reconciliation` (pick the **Business day**, then **Reconcile**). A clean re-run is its own run; the earlier one stays as a record.

`recon.failed`: the run errored (usually Stripe unreachable). Re-run when Stripe is back.

## 3. Month end

`/ops/reconciliation` → *Monthly close export* downloads every ledger entry of the month as CSV (`/api/admin/reconciliation/close/{YYYY-MM}`). Close only after the month's runs are clean.

Walked through 2026-09-29 on the local stack, on a real open alert: the scheduled run for 2026-09-27 had two `missing_in_stripe` items. The run summary showed 0 Stripe transactions; one order had been paid through the real Stripe test account and the other through the payment simulator before the simulator kept balance transactions (G5). So both came from mixing payment providers in one local database, not from a bug. Mismatch runs and their items are also exercised in `tests/integration/backoffice.test.ts`.

**Tip:** don't mix `dev:stack` (Stripe) and `dev:sim` (simulator) orders in one database if you want clean reconciliations; `npm run stack:reset` starts over.
