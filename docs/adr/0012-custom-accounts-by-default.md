# ADR-0012: Custom connected accounts by default, Express kept as an option

- Status: **Accepted** (2026-10-06). Supersedes the *default* chosen in [ADR-0011](0011-connect-account-type.md); the rest of ADR-0011 still applies to Express.
- Date: 2026-10-06

## Context
The project brief asks for Stripe **Custom** connected accounts. ADR-0011 chose Express for every new merchant because a live Custom integration makes the platform build onboarding and KYC screens, collect real terms acceptance and own more compliance. This project runs in Stripe test mode only, where Stripe verifies a Custom account at once when it is given its documented test values, so those costs do not arise here.

## Decision
- `CONNECT_ACCOUNT_TYPE` (`custom` or `express`) picks the type for a **new** merchant; the default is **`custom`**.
- **Custom:** "Start onboarding" creates the account with Stripe's test company data, records terms acceptance with the admin's real IP and user agent (never a hard-coded address), then reads the account status straight away. There is no hosted page; the admin lands back on the merchant page. With the payment simulator the account starts enabled, as Stripe test mode does.
- **Express:** unchanged from ADR-0011 (Stripe-hosted onboarding through Account Links, driven by `account.updated` webhooks).
- A merchant that already has an account keeps its type.
- The admin test tools (`create-account`, `onboard`, `simulate-verification`) stay, and are still how a real-Stripe test account is pushed to verified, failed or restricted.

## Consequences
- The documented default now matches the brief, and both types are tested (`tests/integration/backoffice.test.ts`).
- **A live deployment should use Express** (or Custom with Stripe's embedded onboarding components): this default relies on test values and an admin-recorded terms acceptance, which are not valid for real merchants. `stripeTestFixtures` refuses to run outside test mode.
- With a real Stripe test account the status after "Start onboarding" can be `submitted`; use "Refresh status" or `simulate-verification`.
- The platform's liability for negative balances is the same as in ADR-0011.
