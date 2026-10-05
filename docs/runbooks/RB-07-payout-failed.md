# RB-07 Payout failed

Alert: `payout.failed` (SEV2). Stripe reported `payout.failed` for a connected account; the message includes Stripe's `failure_code` (e.g. `account_closed`, `no_account`, `invalid_account_number`).

## What happened

The money is safe: a failed payout goes back to the merchant's Stripe balance. Stripe also disables payouts on the account until the bank details are fixed, so later payouts fail or wait too.

## 1. Check

`/ops/payouts` (recent payouts, status and failure) and `/ops/merchants/{id}` → **Payouts** and **Stripe account** (requirements due).

## 2. Fix

1. Ask the merchant to update the bank account through **Continue onboarding / update details** (Stripe-hosted; we never see bank details).
2. When the account shows payouts enabled again, send a manual payout from `/ops/merchants/{id}` → **Payouts** (above CA$5,000 a second finance user approves it in `/ops/payouts` → *Waiting for approval*), or wait for the automatic schedule.

## 3. Verify

The new payout reaches `paid` (Connect `payout.paid`), and the next daily reconciliation counts it. Resolve the alert.

Walked through 2026-09-29 as a read-through against the payout event handler in `src/modules/payouts/payouts.ts`; a failed payout and its alert are covered by `tests/integration/backoffice.test.ts`.
