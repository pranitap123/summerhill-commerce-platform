# Operations: Reliability, Observability, Support and Cost

Status: v1.0 · Updated 2026-09-29 · Parent: [BLUEPRINT](BLUEPRINT.md)

> **Design + current** ([documentation index](README.md)). Observability, alerting (§2–§3) and the runbooks (§6) are built. SLOs, on-call, incident process, DR targets, running costs and support staffing (§1, §4, §5, §7–§9) describe a real launch.

## 1. Service levels

The business runs when the store is open (≈ 08:00–21:00 ET, 7 days). Reliability targets are strictest in those hours.

| Capability | SLO (monthly) | Measured by |
|---|---|---|
| Storefront pages | 99.9% successful responses, p95 < 800 ms TTFB | Synthetic + RUM |
| Checkout (session creation) | 99.95% during store hours | Success rate of `POST /checkout` excl. 4xx |
| Webhook processing | 99.9% processed < 60 s; 0 lost | `webhook_events` lag |
| Capture after picking | 99.9% < 2 min | job metrics |
| Merchant console | 99.9% during store hours; new orders visible < 30 s | Synthetic + event lag |
| Catalogue freshness | Delta sync succeeded within the last 30 min during store hours | ingest runs |
| Notifications | 99% delivered < 2 min | provider callbacks |

Error budget policy: if an SLO's monthly budget is burnt, feature work pauses for reliability work on that path.

## 2. Observability

- **Logs:** structured JSON (pino) → a log platform (Axiom / Better Stack / Datadog). Standard fields: `requestId`, `route`, `userId` (internal id), `merchantId`, `orderId`, `jobId`, `durationMs`, `level`. Redaction of `authorization`, `cookie`, `stripe-signature`, email, phone.
- **Errors:** Sentry for app, worker and browser, with source maps and release tagging.
- **Metrics / dashboards:**
  1. *Business:* orders placed / accepted / collected, GMV, conversion funnel, auto-rejects, fill rate, refunds, disputes.
  2. *Payments:* auth success rate, decline codes, capture failures, hold amount vs. captured, reconciliation status.
  3. *Ops:* accept time, pick time, orders per slot vs. capacity.
  4. *System:* latency/error per route, DB connections/slow queries, job queue depth and age, webhook lag, ingest freshness.
- **Tracing:** OpenTelemetry on the app and worker (sampled at 10%, 100% for checkout and capture). Implemented in `src/server/tracing.ts` (G6-08): on only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; sampling with the standard `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` variables. A span per API request and per job, plus pg and outbound HTTP (Stripe, Elasticsearch) spans. One checkout is one trace across processes: W3C trace context travels in the outbox event and in the Checkout Session metadata that Stripe returns on the webhook, so request → webhook → order placed → confirmation email line up. Only ids and parameterised SQL are recorded. Locally: `npm run stack:observability` starts Jaeger (UI http://localhost:16686, OTLP on :4318).
- **Uptime:** synthetic checks every minute for the home page, a product page, search, `/api/ready`; a daily synthetic checkout in test mode on staging.

## 3. Alerting

Rules are code (G6-09): `src/modules/ops/alertRules.ts` holds a route (severity, channel, runbook) for every alert kind the code raises, and a unit test fails if a new kind has none. Event rules are raised where the failure is detected (a dead-lettered webhook or capture job, a reconciliation mismatch, a failed payout); condition rules (webhook lag or repeated failure, the card-testing pattern, a held ingest run) are checked every minute by the `alerts.evaluate` job. Each alert is stored once, logged with `alert.channel` for the log platform to page on, and emailed to the channel's address (`ALERT_EMAIL_PAGE`, `ALERT_EMAIL_OPS`, `ALERT_EMAIL_FINANCE`). Rows marked *(not yet)* below need metrics the demo doesn't collect.

| Alert | Condition | Severity | Route |
|---|---|---|---|
| Checkout failing | error rate > 5% for 5 min | SEV1 | page *(not yet)* |
| Webhooks failing / lagging | any event failed 3× or lag > 5 min | SEV1 | page |
| Capture failed | any `payment_issue` | SEV2 | page in store hours |
| Order unaccepted | > 15 min (auto-reject fired) | SEV3 | Slack `#ops` |
| Auth nearing expiry | uncaptured auth > 5 days | SEV2 | Slack + email |
| Reconciliation mismatch | any | SEV2 | `#finance-alerts` |
| Ingest stale / anomaly held | no successful delta in 30 min (store hours) *(not yet)* / guard tripped | SEV3 | `#ops` |
| Card-testing signal | decline rate > 30% over 15 min or > 20 declines/10 min | SEV1 | page |
| Payout failed / merchant restricted | webhook | SEV2 | `#ops` + email |
| DB | CPU > 80% 10 min, storage > 80%, replication lag | SEV2 | page *(not yet)* |

## 4. On-call

- Pilot: the two engineers rotate weekly; paging is active during store hours + 1 h. Out of hours: SEV1 only.
- Tools: PagerDuty/Opsgenie free tier or Better Stack; runbook links in every alert.
- Weekly ops review: alerts fired, incidents, SLOs, top errors, merchant feedback.

## 5. Incident management

| Severity | Definition | Response | Comms |
|---|---|---|---|
| SEV1 | Customers can't order or pay; money wrong; data breach suspected | Ack 5 min; all hands | Status page + merchant phone call |
| SEV2 | Degraded (e.g. captures failing, console slow) | Ack 15 min | Merchant message |
| SEV3 | Minor / single feature | Next business day | Internal |

Process: an incident lead is named, a timeline is kept in the incident channel, mitigate first (kill switches: `checkout.enabled`, `merchant.accepting_orders`), then fix. A blameless post-mortem within 5 business days for SEV1/2, with actions tracked.

**Data breach:** follow the PIPEDA playbook in [SECURITY §7.2](SECURITY_AND_COMPLIANCE.md#72-obligations-canadaontario-to-be-confirmed-by-counsel): contain, assess real risk of significant harm, notify the OPC and affected individuals if required, record.

## 6. Runbooks

Written and walked through on the local stack in G7-07: **[docs/runbooks/](runbooks/README.md)**. Every alert names its runbook (`src/modules/ops/alertRules.ts`; a unit test fails if a runbook file is missing).

| # | Runbook | # | Runbook |
|---|---|---|---|
| RB-01 | Local setup: [README](../README.md#quick-start) | RB-09 | [Reconciliation mismatch](runbooks/RB-09-reconciliation-mismatch.md) |
| RB-02 | Deploy and roll back: *not written, no production* | RB-10 | [Ingest anomaly held](runbooks/RB-10-ingest-held.md) |
| RB-03 | [Replay a Stripe webhook](runbooks/RB-03-webhook-replay.md) | RB-11 | [Search index rebuild](runbooks/RB-11-search-rebuild.md) |
| RB-04 | [Capture failed](runbooks/RB-04-capture-failed.md) | RB-12 | [Pause a merchant / disable checkout](runbooks/RB-12-kill-switches.md) |
| RB-05 | [Authorisation about to expire](runbooks/RB-05-auth-expiring.md) | RB-13 | [Rotate secrets](runbooks/RB-13-rotate-secrets.md) |
| RB-06 | [Merchant restricted](runbooks/RB-06-merchant-restricted.md) | RB-14 | [Restore the database](runbooks/RB-14-restore-database.md) |
| RB-07 | [Payout failed](runbooks/RB-07-payout-failed.md) | RB-15 | Product recall: *Backlog (needs the recall tool)* |
| RB-08 | [Dispute received](runbooks/RB-08-dispute.md) | RB-16 | [Privacy request](runbooks/RB-16-privacy-request.md) |

## 7. Disaster recovery and continuity

| Scenario | RPO | RTO | Plan |
|---|---|---|---|
| App host outage | 0 | 30 min | Redeploy to a second region/provider from CI; DNS switch |
| Database loss/corruption | ≤ 5 min | ≤ 1 h | PITR restore; webhook replay from Stripe covers the gap |
| Search outage | n/a | 0 | Automatic Postgres FTS fallback |
| Stripe outage | n/a | n/a | Checkout disabled with a banner; captures queue and retry |
| Merchant catalogue source down | n/a | n/a | Serve the last good catalogue; stale alert |
| Merchant tablet/network down | n/a | 5 min | Console works on any phone; orders also emailed; phone escalation |

A DR drill (restore + webhook replay) runs before launch and quarterly afterwards.

## 8. Running costs

Estimates for the pilot (1 merchant, < 1,000 orders/month). Verify current vendor pricing when procuring.

| Item | Choice (example) | Est. CA$/month |
|---|---|---|
| App hosting | Vercel Pro (2 seats) or Render/Fly | 40–70 |
| Worker | Render/Fly small instance | 10–25 |
| Postgres | Neon/Supabase/RDS small with PITR | 30–90 |
| Search | Postgres FTS: 0 · Elastic Cloud smallest: ~130+ | 0–150 |
| Dagster | Self-hosted on the worker VM / Dagster+ Solo | 0–15 |
| Object storage + CDN | S3/R2 + CDN | 5–15 |
| Email | Postmark/Resend | 15–25 |
| SMS | Twilio (≈ 3 SMS/order) | 20–60 |
| Monitoring | Sentry team + log platform + uptime | 40–100 |
| Rate limiting | Upstash Redis | 0–15 |
| Domain, status page, misc. | | 10–30 |
| Stripe Connect account fees | per active connected account | ~3 |
| **Total** | | **≈ 200–600** (+ one-off pen test ≈ $5–15k) |

The search-engine decision (ADR-0007) is the largest single variable.

## 9. Customer and merchant support

- **Channels:** email + help-centre form (Help Scout / Zendesk / Front); order-page "Report a problem"; merchant hotline (phone) for pilot merchants.
- **Hours:** during store hours; first response target: 1 h for order-day issues, 1 business day otherwise.
- **Tools:** admin order timeline, refund within role limits, resend notifications, cancel, customer history. Macros for common cases.
- **Feedback loop:** weekly tag report (missing items, substitutions, late pickups) shared with the merchant; product fixes prioritised from the top tags.
