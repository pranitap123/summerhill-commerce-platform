# Demo script: a 5-minute walkthrough

Status: v1.0 · Updated 2026-09-29 · Parent: [README](../README.md)

One order, end to end: **browse → checkout with a card hold → the store picks it (a weight change and a replacement) → the final amount is captured → handover → a refund → reconciliation.** It shows the three things this project is about: charging only for what was actually packed, the merchant console, and money that reconciles to the cent.

Everything runs locally with the **payment simulator** (Stripe's test cards, no Stripe account). The same walkthrough is recorded by `tests/e2e/demo.spec.ts` ([§ Recording](#recording)); the screenshots and the GIF in the README come from that recording.

## Before you start (once)

Follow the [README quick start](../README.md#quick-start) with the simulator (`dev:sim` + `worker:sim`, or a production build: `npm run build:sim && npm run start:sim`). Then open three browser windows (or profiles), because each role signs in separately:

| Window | Who | Sign in |
|---|---|---|
| A | Customer (guest) | nobody |
| B | Store picker | `DEMO_PICKER_EMAIL` / `DEMO_USER_PASSWORD` from `web/summerhill-commerce/stack.env`, then the 6-digit code from `npm run demo:totp --prefix web/summerhill-commerce` |
| C | Support, later finance | `DEMO_SUPPORT_EMAIL`, later `DEMO_FINANCE_EMAIL`, same password and code |

Emails (order confirmation, "your order is ready", refund) arrive in Mailpit, http://localhost:8025.

## The script

| Time | Step | Do | Say |
|---|---|---|---|
| 0:00 | **Browse** (A) | Home page → search `honeycrisp` → open *Harbour Kitchen Honeycrisp Apples* | Catalogue from the ingest pipeline (synthetic data), searched in Elasticsearch with a Postgres fallback. Items charged by weight show a price per lb and the estimated weight |
| 0:30 | **Fill the cart** (A) | Add 2 × *Harbour Kitchen Honeycrisp Apples*, 1.5 lb *Maple Row Bananas*, 3 × *Cedar & Salt Sparkling Water*, 2 × *Lakeside Farms Honeycrisp Apples* | Bananas are sold by weight: the price is an estimate. Water adds HST and a bottle deposit |
| 1:00 | **Checkout with a hold** (A) | Cart → pick a pickup time → email → **Pay securely** → card `4242 4242 4242 4242` → **Authorise** | The cart shows *"We place a temporary hold and charge only the final amount after your order is packed."* The card is authorised, not charged. The order page shows the hold and a 6-digit pickup code |
| 1:45 | **Accept** (B) | `/console` → the new order → **Accept order** → **Start picking** | Orders not accepted within 15 minutes are rejected automatically and the hold is released |
| 2:00 | **Scan and weigh** (B) | Type the Harbour Kitchen apples' barcode from the pick slip (`🖨 Pick slip & labels`) → Enter; mark the water **✓ Picked**; scan the bananas' deli-scale label | A wrong barcode is refused. The deli label carries the real price, so the bananas' line changes from the estimate to the weighed amount |
| 2:40 | **Replace** (B) | Lakeside apples → **⇄ Replace** → first suggestion → **Use this replacement** | The customer chose "best match" at checkout |
| 2:55 | **Approve the replacement** (A) | Reload the order page → **Accept** | The customer can accept or refuse; a refused replacement is simply not charged |
| 3:10 | **Capture** (B) | **Complete picking** | The worker captures exactly the final total (weights, replacement) with the platform fee, and releases the rest of the hold. The order page now shows *Charged* and how much of the hold was released. Idempotent: a retry never charges twice |
| 3:30 | **Handover** (B) | Enter the customer's pickup code → **Hand over** | A wrong code is refused (5 attempts). The handover record is the evidence if the customer later disputes the charge |
| 3:45 | **Refund** (C, support) | `/ops/orders` → the order → Refund: case *damaged*, 1 × Harbour Kitchen apples, a reason → **Refund** | The liability matrix decides who pays: damaged in store → the merchant. Support can refund up to $50 per order; every action is in the audit log. Window A shows the refund |
| 4:20 | **Reconcile** (C, finance) | Sign in as finance → `/ops/reconciliation` → today → **Reconcile** → then `/ops/orders/{order}` → Ledger | Every Stripe (here: simulator) balance transaction is matched to our payments and refunds to the cent, and six invariants are checked over all orders. The order's double-entry ledger balances |
| | | *On a database with older test orders, the run may list `missing in stripe` items for orders paid before the simulator kept balance transactions, or through a different provider; that's the check working ([RB-09](runbooks/RB-09-reconciliation-mismatch.md)). `npm run stack:reset` starts clean.* | |
| 5:00 | End | | Questions: the design notes are in [BLUEPRINT](BLUEPRINT.md) and the [ADRs](adr/) |

**If something goes wrong:** no pickup times in the cart → the store may be closed now; as the owner (`DEMO_OWNER_EMAIL`) open `/console` → Settings and widen the hours or lead time. Order stuck on *Waiting for payment* → the worker isn't running.

## Variations

- **Declined card:** `4000 0000 0000 0002`. **3-D Secure:** `4000 0027 6000 3184`.
- **Dispute:** pay with `4000 0000 0000 0259`; once captured, the charge is disputed and appears in `/ops/disputes` with an evidence pack ([RB-08](runbooks/RB-08-dispute.md)).
- **Held ingest:** `CATALOG_FIXTURE_FRACTION=0.5 npm run pipeline:ingest` → the anomaly guard holds the run ([RB-10](runbooks/RB-10-ingest-held.md)).
- **Real Stripe test mode:** `dev:stack` + `worker` with an `sk_test_` key and `npm run stack:up:stripe`; the flow is the same, with Stripe Checkout instead of the simulator page.

## Recording

```bash
cd web/summerhill-commerce
DEMO_RECORD=1 npx playwright test tests/e2e/demo.spec.ts   # needs the stack, seeded users and a running app (e.g. start:sim)
node scripts/demo-media.mjs                                 # frames → docs/media/fulfilment.gif (needs ffmpeg)
```

The spec follows this script, saves the screenshots to `docs/media/` and a frame of the store's window at every step, which `demo-media.mjs` turns into the GIF. It's skipped in normal E2E runs. `DEMO_SKIP_BROWSE=1` keeps the existing browse screenshots (01–03); `PW_CHANNEL=chrome` uses an installed Chrome; `E2E_WORKER=external` uses a worker you already started.

Rehearsed 2026-09-29 on the local stack (production simulator build, installed Chrome): the whole script passed end to end in 9.5 minutes on the 8 GB development machine, which also produced the README media. Getting there exposed a leak: every E2E run left its worker running on Windows (teardown didn't wait for `taskkill`), and the accumulated workers starved the database. Fixed in `tests/e2e/global-setup.ts`.
