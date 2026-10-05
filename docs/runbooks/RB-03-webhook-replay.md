# RB-03 Replay a Stripe webhook

Alerts: `webhook.failed` (SEV1, an event failed 10 times and was dead-lettered), `webhook.lagging` (SEV1, events waiting > 5 min), `job.dead` on queue `stripe.webhook.process`.

## How webhooks flow

`POST /api/webhooks/stripe` (and `/stripe-connect`) verifies the signature, stores the event in `ops.webhook_events` and enqueues a `stripe.webhook.process` job in one transaction, then answers 200. The worker processes the job. Duplicates are ignored (`event_id` is unique) and every handler checks the order's state first, so processing an event twice changes nothing. See [PAYMENTS_AND_MONEY](../domains/PAYMENTS_AND_MONEY.md).

## 1. Mitigate

- **Lagging, nothing failed:** is the worker running? Start it (`app: npm run worker`). Events wait safely; Stripe keeps retrying delivery for 3 days.
- **Many events failing with the same error:** a bug or an outage (Stripe, database). If customers are affected (orders stuck in *Waiting for payment*), consider pausing checkout ([RB-12](RB-12-kill-switches.md)).

## 2. Find the cause

```bash
app: npm run ops -- alerts            # the alert names the event id
app: npm run ops -- jobs:dead         # last error of each dead job
```

```sql
SELECT event_id, type, status, attempts, last_error, received_at
FROM ops.webhook_events WHERE status IN ('failed', 'pending') ORDER BY received_at;
```

Search the worker log for the event id (`stripe.event_id` in the log line and the trace).

## 3. Fix and replay

Fix the cause first (deploy the fix, wait for the outage to end). Then:

```bash
app: npm run ops -- webhook:replay evt_1Q… --by "your name"
# webhook evt_1Q…: processed
```

The replay resets the event to *pending*, writes `webhook.replay` to the audit log and processes it at once. It refuses an event that is already processed or ignored (409), one still queued or running in the worker (409 `IN_PROGRESS`: wait, or check the worker is up), and an unknown id (404).

**Event never arrived** (not in `ops.webhook_events`; Stripe dashboard shows delivery failures, e.g. the endpoint was down for longer than Stripe retries, or the signing secret was wrong): re-send it from Stripe, which delivers it to the endpoint like the original.

```bash
stripe events resend evt_1Q…                    # platform event
stripe events resend evt_1Q… --account acct_…   # Connect event
```

Stored payloads are kept 90 days (`RETENTION.webhookPayloadDays`); older events can only be re-sent from Stripe, which keeps them 30 days.

## 4. Verify

- `ops.webhook_events.status` is `processed` or `ignored`.
- The order has moved on (e.g. *Order placed*) and its timeline shows the event.
- Resolve the alert.

Walked through 2026-09-29: `tests/integration/resilience.test.ts` › "runbook RB-03" (dead job → replay → order placed, audited; second replay 409, unknown 404).
