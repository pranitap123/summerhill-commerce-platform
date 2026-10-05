# ADR-0011: Stripe Connect account type

- Status: **Accepted** (G5-02, 2026-09-28)
- Date: 2026-09-27 (proposed), 2026-09-28 (decided)

## Context
The first code created **Custom** connected accounts and submitted KYC data programmatically, using Stripe test values and a hardcoded ToS acceptance (`ip: 127.0.0.1`). With Custom accounts the platform must build the onboarding and KYC-update UI, collect real ToS acceptance, handle ongoing verification requirements, and own more compliance and liability. Express accounts use Stripe-hosted onboarding and a Stripe Express dashboard.

## Options
| | Custom | Express | Custom + Embedded Components |
|---|---|---|---|
| Onboarding UI | We build it | Stripe-hosted | Stripe components inside our UI |
| KYC updates | We build them | Stripe | Stripe components |
| Branding control | Full | Partial | High |
| Build effort | High | Low | Medium |
| Our compliance burden | Highest | Lower | Medium |

## Decision
**Express accounts with Stripe-hosted onboarding (Account Links)** for every new merchant.

- `/ops/merchants/{id}` → "Start onboarding" creates the Express account (idempotency key `express-account:merchant:{id}`, so a retry never creates a second one) and sends the admin (or the merchant) to Stripe's onboarding page. Business details, identity documents, the bank account and the Connected Account Agreement are all collected by Stripe, with a real ToS acceptance from the person onboarding.
- Status is driven by `account.updated` Connect webhooks (G2-11): `charges_enabled`, `payouts_enabled`, `requirements.disabled_reason` and `requirements.currently_due` are stored on the merchant; "Refresh status" reads the account on demand.
- Bank-account changes happen only in Stripe-hosted flows (threat T14): our UI has no bank fields.
- Go-live stays our decision: `go_live` is refused until charges are enabled **and** a catalogue is published (A1).
- The pre-G5 Custom-account routes (`create-account`, `onboard`, `simulate-verification`) stay as **admin-only test tools** that use Stripe's documented test values; `simulate-verification` answers 404 in production. They're not part of the merchant flow.
- With the payment simulator (no Stripe account), the onboarding link goes to `/simulator/onboarding/{account}`, which enables the account and records the same `account.updated` event, so the demo and the end-to-end test run the real code path.

## Consequences
- Less to build and less compliance surface; merchants see Stripe's Express dashboard for payouts and tax forms.
- Branding on the onboarding pages is Stripe's (acceptable for a reference implementation).
- With destination charges and Express accounts the platform remains liable for negative balances (refunds and disputes after payout): mitigated by the payout delay, reserves and recovery through transfer reversals (PAYMENTS §8).
