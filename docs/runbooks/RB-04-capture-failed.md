# RB-04 Capture failed

Alerts: `capture.failed` (SEV2, the capture job was dead-lettered and the order moved to **Payment problem** / `payment_issue`), `capture.shortfall` (SEV3, the final total was higher than the authorisation and the difference was absorbed).

## How capture works

When the picker completes an order (`picked`), the `payment.capture` job captures exactly the final amount with the idempotency key `capture:{orderId}`, posts the ledger journal and moves the order to `ready`. Retries use the same key, so a capture that reached Stripe is never repeated. After 5 failed attempts the order goes to `payment_issue`; the console shows "The payment could not be captured. Support has been alerted." The customer's card hold is still in place.

## 1. Mitigate

Tell the store not to hand over the order yet (it can't be handed over from `payment_issue` anyway). The authorisation lasts about 7 days from checkout; check `capture_before` (below). If it expires within 48 h, this is also [RB-05](RB-05-auth-expiring.md).

## 2. Find the cause

```bash
app: npm run ops -- jobs:dead          # queue payment.capture, last_error
```

```sql
SELECT o.public_id, o.status, p.status AS payment, p.amount_authorized_cents, p.capture_before,
       p.capture_attempts, p.last_error
FROM commerce.orders o JOIN finance.payments p ON p.order_id = o.id
WHERE o.status = 'payment_issue';
```

| Error | Cause | Next step |
|---|---|---|
| Timeouts, 5xx, `did not answer` | Stripe or network outage | Wait for it to end (status.stripe.com), then retry |
| `account ... restricted`, `charges_enabled` | The merchant's Connect account is restricted | [RB-06](RB-06-merchant-restricted.md), then retry |
| `charge_expired_for_capture`, PaymentIntent `canceled` | The authorisation expired | Can't be captured: cancel (below) and ask the customer to pay again |
| Anything else | A bug | Fix it, then retry |

## 3. Fix

**Retry the capture** once the cause is gone:

```bash
app: npm run ops -- capture:retry SH-7KQ2M4 --by "your name" --reason "Stripe outage over"
# order SH-7KQ2M4: captured
```

It audits `payment.capture_retry`, then runs the normal capture with the same idempotency key and moves the order to `ready` (the customer gets the "ready for pickup" email). It only accepts an order in `payment_issue` (409 otherwise). If everything on the order was unavailable, it voids instead (`voided`).

**Cannot be captured:** `/ops/orders/{order}` → Cancel. The hold is released, the customer is notified, nothing is charged. Tell the store.

**Shortfall** (`capture.shortfall`): nothing to fix on the order, the platform absorbed the difference. Check why the final total exceeded the hold (weight much higher than estimated, a costly replacement); if frequent, raise the hold buffer (PAYMENTS §3).

## 4. Verify

The order is `ready` (or `cancelled`), `finance.payments.status` is `captured` (or `canceled`), the order's ledger balances (`/ops/orders/{order}` → Ledger), and the next reconciliation is clean. Resolve the alert.

Walked through 2026-09-29: `tests/integration/resilience.test.ts` › "runbook RB-04" (capture fails 2× → dead letter → `payment_issue` → retry → one capture, one journal, `ready`, audited).
