# RB-05 Authorisation about to expire

Alerts: `payment.auth_expiring` (SEV2, an uncaptured authorisation expires within 48 h), `payment.authorization_canceled` (SEV2, Stripe cancelled a hold, usually because it expired), `payment.late_authorization` (SEV2, a card was authorised for an order that was already closed; it was voided automatically).

## Why it matters

Card holds last about 7 days (`finance.payments.capture_before`). An order that isn't picked and captured by then can't be charged, so the store would hand over groceries for free. The hourly `payment.authExpiryGuard` job raises one alert per payment 48 h ahead.

## 1. Mitigate

Find the order and where it's stuck:

```sql
SELECT o.public_id, o.status, p.capture_before
FROM finance.payments p JOIN commerce.orders o ON o.id = p.order_id
WHERE p.status = 'requires_capture' AND p.capture_before < now() + interval '48 hours'
ORDER BY p.capture_before;
```

| Order status | Action |
|---|---|
| `placed` / `accepted` / `picking` | Ask the store to pick it now (the console queue shows it); capture follows automatically |
| `picked` or `payment_issue` | Capture is running or failing: [RB-04](RB-04-capture-failed.md) |
| Pickup is after `capture_before` | Shouldn't happen (slots are limited to the hold window, ADR-0005); cancel in `/ops/orders/{order}` and ask the customer to order again |

## 2. Authorisation already cancelled

The order is cancelled automatically (timeline: `authorization_canceled`). Check that the store hasn't already packed it. If it was already handed over, the goods were given away: record it and tell finance.

## 3. Late authorisation

Nothing to do: the stale hold was voided (timeline `late_authorization_voided`). If it recurs, find out why checkouts complete after their order was abandoned (session expiry vs. the abandoned-checkout sweep).

## 4. Verify

`finance.payments.status` is `captured` or `canceled`; resolve the alert.

Walked through 2026-09-29 as a read-through against `runAuthExpiryGuard` and the `payment_intent.canceled` handler. The guard's timing is covered by the integration suite (fake clock).
