# RB-06 Merchant restricted / requirements due

Signal: Connect `account.updated` sets the merchant's `onboarding_status` to `restricted` (Stripe disabled charges or payouts) or lists `requirements_due`. Captures may then fail ([RB-04](RB-04-capture-failed.md)) and payouts stop ([RB-07](RB-07-payout-failed.md)).

## 1. Mitigate

`/ops/merchants/{id}` → **Stripe account** shows the status and the requirements due.

- **Charges disabled:** checkout already refuses this merchant (charges must be enabled to take orders). Placed orders can't be captured until it's fixed, so tell the store to hold off picking. **Pause (no new orders)** under Lifecycle makes it explicit on the storefront ([RB-12](RB-12-kill-switches.md)).
- **Only requirements due** (with a deadline): nothing breaks yet; contact the merchant.

## 2. Fix

The merchant fixes it in Stripe-hosted onboarding. **Continue onboarding / update details** creates a fresh link (links are single-use and expire); send it to the merchant's owner.

When Stripe re-verifies the account, `account.updated` updates the status automatically. If the webhook was missed, `POST /api/admin/merchants/{id}/refresh-status` reads the account from Stripe.

## 3. Afterwards

- **Resume** the merchant if you paused it.
- Retry captures that failed meanwhile: `app: npm run ops -- capture:retry <order> --by <name>` ([RB-04](RB-04-capture-failed.md)).

Walked through 2026-09-29 as a read-through against the code, backed by the integration suite: `account.updated` with a disabled reason sets the merchant to *restricted* (`tests/integration/orders.test.ts`), and checkout refuses a paused merchant (`tests/integration/backoffice.test.ts`). With the payment simulator, `POST /api/admin/merchants/{id}/simulate-verification` with outcome `restricted` reproduces it locally.
