# RB-12 Pause a merchant / disable checkout

Use when customers must not place new orders: a SEV1 in payments, `payments.card_testing` (a burst of declined cards from bots), a merchant that can't fulfil, a pricing bug.

## Switches

| Switch | Effect | Where |
|---|---|---|
| Flag `checkout.enabled` off | **All** new checkouts are refused with a friendly message; `/api/v1/status` reports it; carts and placed orders are untouched | `/ops/flags` |
| Merchant **Pause (no new orders)** | That merchant's checkout refuses; its placed orders are still handled | `/ops/merchants/{id}` → Lifecycle |
| Flag `support.auto_refund` off | Problem reports need a person instead of being refunded automatically | `/ops/flags` |
| Flag `email.enabled` off | Emails are logged as skipped instead of sent (e.g. a template leaks data) | `/ops/flags` |

Every change is written to the audit log.

## Card testing

1. Turn `checkout.enabled` off.
2. Look at the declines: the `payments.card_testing` alert data, and the `payment_intent.payment_failed` events in `ops.webhook_events`.
3. Tighten limits (checkout rate limit in `src/modules/ops/rateLimit.ts`, Stripe Radar rules), then turn checkout back on and watch the alert.

## Resume

Turn the flag back on or **Resume** the merchant. Tell merchants and support. Resolve the alert.

Walked through 2026-09-29 with the integration suite (`tests/integration/backoffice.test.ts`): `checkout.enabled` off → checkout refused with `CHECKOUT_DISABLED`, back on → works, and the change is in the audit log; a paused merchant's checkout is refused.
