# Product Requirements: Summerhill Marketplace

Status: Design exploration (v0.2) · Owner: Pranita Panchal · Updated 2026-09-29 · Parent: [BLUEPRINT](../BLUEPRINT.md)

> **Design exploration** ([documentation index](../README.md)). Written for a real pilot with a real merchant. The GitHub release builds the product described here on synthetic data; the pilot, launch checklist and business metrics don't apply.

## 1. Problem and opportunity

- Toronto's independent specialty grocers (butchers, bakeries, gourmet markets) carry products the big chains don't. Their online ordering is fragmented: each has its own shop, or none, and sells under its own brand only.
- Shoppers who want these products have to visit each store's site (or the store), with different checkouts and different pickup rules.
- Merchants want online revenue without building and running e-commerce, payments and customer support themselves.

**Proposition:**
- *Shoppers:* "Order from Toronto's best independent grocers in one place; pick up or get it delivered."
- *Merchants:* "Your catalogue online in days; we handle checkout, payments and customer service. You pick and pack."

**Honest caveat:** our launch merchant already has an online shop through another vendor. Our pilot must prove we add something that shop doesn't: incremental customers, lower cost, or better operations. Otherwise merchant #2 won't sign. Track *incremental* orders from day one (PRD §8).

## 2. Personas

| Persona | Needs | Pain today |
|---|---|---|
| **Maya, busy professional shopper** (30s, mobile, orders weekly, $60 baskets) | Fast reorder, accurate availability, knows the final price, quick pickup | Items missing at pickup; surprise price changes on weighed goods |
| **Guest shopper** (one-off gift or specialty item) | No forced signup, clear total | Account walls |
| **Store picker, Summerhill staff** (tablet at the counter, busy) | Clear queue, pick list in aisle order, easy weight entry, one-tap substitutions | Juggling phone orders and web orders |
| **Store manager / merchant owner** | Sales, payouts, fees, disputes; control over hours and slot capacity | Opaque fees, slow payouts |
| **Platform ops admin** (our staff) | Onboard merchants, fix orders, refund, see health | No tools; uses the Stripe dashboard by hand |
| **Platform finance** | Reconcile payouts, fees and tax monthly | Manual spreadsheet work |
| **Support agent** | See an order's full history, refund within policy, contact the customer | No single view of an order |

## 3. Key user journeys

### J1 First order (guest, pickup)
Landing → search "sourdough" → product page → add to cart → add bananas (priced per lb: the UI says "~2 lb est. $2.98, final price after weighing") → cart shows HST on taxable items and the estimate → checkout: pick a pickup slot (only slots that fit item availability and lead time), enter email + phone, set a substitution preference per item → Stripe payment (card **authorised**, shown as "hold of $X") → confirmation page and email with order number and pickup code.

### J2 Merchant fulfils
Tablet chime → order in the "New" column → picker taps **Accept** (auto-reject after 15 min, releasing the hold) → pick list sorted by category/aisle → for each line: ✔ picked / ⚖ enter weight / ↔ substitute / ✖ unavailable → **Complete picking** → the system recalculates totals, **captures** the final amount and texts the customer "ready, final total $X" → at pickup the customer shows the code → staff tap **Handed over**.

### J3 Problem after pickup
The customer reports a missing item within 48 h through the order page → a support ticket opens with order context → the agent issues a line refund per policy → refund email → the cost is charged to the merchant or the platform according to the liability matrix.

### J4 Merchant onboarding (admin-assisted, v1)
Admin creates the merchant → sends the Stripe onboarding link (Express) or collects KYC (Custom) → sets up the catalogue connector and runs the first import in "draft" → the merchant reviews the draft catalogue → sets store hours, slot capacity and lead times → go-live toggle (only if `charges_enabled`).

## 4. Use cases

Priority: **P0** pilot blocker · **P1** needed within the pilot window · **P2** after the pilot.

### 4.1 Shopper

| ID | Use case | P | Acceptance criteria |
|---|---|---|---|
| S1 | Browse by category/subcategory | P0 | Paginated; sort by relevance/price/name; hides inactive products and non-live merchants |
| S2 | Search | P0 | Typo-tolerant; synonyms (e.g. "pop"→"soda"); filters: category, price, organic, on sale; zero-result queries logged |
| S3 | Product page | P0 | Price per unit (e.g. "$1.49/lb, est. 1 lb"), sale price with strikethrough, tax indicator, deposit, availability days, images |
| S4 | Cart | P0 | Server-side for signed-in users, merged at login; quantity rules (min/max, 0.5 lb steps for weighed items); **one merchant per cart** with a clear message; re-priced on open |
| S5 | Choose pickup slot | P0 | Only slots with capacity, after lead time, within store hours, compatible with every item's `availableDays`; slot held 10 min during checkout |
| S6 | Replacement preferences | P0 | Per line: best match / up to 3 specific items (ranked) / refund. Default: best match for produce, refund otherwise. Replacements are shown live and can be rejected until picking completes |
| S7 | Pay | P0 | Server-computed estimate + HST + deposits + weight buffer; card authorised; guest or account |
| S8 | Order confirmation | P0 | Created by webhook; email with order number, pickup code, slot, estimated total |
| S9 | Order tracking | P0 | Status page (placed → accepted → picking → ready → collected); final receipt |
| S10 | Approve/decline substitutions | P1 | SMS/email link; if no response within 10 min the preference applies |
| S11 | Cancel order | P0 | Allowed until accepted → hold released instantly |
| S12 | Report a problem | P1 | Within 48 h of pickup: missing/damaged/wrong item with optional photo |
| S13 | Account: sign up/in, reset, addresses, preferences | P0 | Email verification; rate-limited; password rules |
| S14 | Order history + reorder | P1 | Reorder adds available items and flags unavailable ones |
| S15 | Guest order access | P0 | Magic link in email; lookup by order number + email |
| S16 | Delivery | P2 (v1.1) | Postal-code eligibility, delivery fee, tip, courier tracking |
| S17 | Saved cards | P2 | Stripe Customer + SetupIntent |

### 4.2 Merchant staff (merchant console)

| ID | Use case | P | Acceptance criteria |
|---|---|---|---|
| M1 | Sign in (per-staff accounts) | P0 | Roles `merchant_owner`, `merchant_staff`; sees only their merchant's data |
| M2 | New-order alert | P0 | Audible + visual on the console; email backup; escalation SMS to the manager at 10 min |
| M3 | Accept / reject | P0 | Reject needs a reason; auto-reject at 15 min (configurable) |
| M4 | Pick list | P0 | Grouped by category; shows quantity, unit, substitution preference, customer notes |
| M5 | Record actual weight | P0 | Accept ±50% of estimate without warning, beyond that confirm; unit-price × weight shown live |
| M6 | Substitute | P0 | Search the merchant's catalogue; price rules (§ORDERS 6); records the reason |
| M7 | Mark unavailable | P0 | Line removed from capture; optional product "out of stock today" toggle |
| M8 | Complete picking | P0 | Shows final total; triggers capture; prints/label (P1) |
| M9 | Handover | P0 | Enter/scan pickup code; marks collected |
| M10 | Manage hours, slot capacity, lead times, holiday closures | P1 | Changes apply only to future slots |
| M11 | Temporarily hide product | P1 | Override survives re-ingest; auto-expiry option |
| M12 | View sales, fees, payouts, statements | P1 | Monthly statement PDF with commission + tax lines |
| M13 | Pause store | P0 | Stops new orders immediately (e.g. short-staffed) |

### 4.3 Platform admin / support / finance

| ID | Use case | P | Acceptance criteria |
|---|---|---|---|
| A1 | Merchant lifecycle: create, onboard, go live, pause, offboard | P0 | Go-live blocked unless `charges_enabled` and catalogue published; audited |
| A2 | Merchant health | P0 | Stripe requirements due, disabled reason, payout status, acceptance SLA stats |
| A3 | Catalogue connector config + ingest runs | P0 | Run history, diffs, errors; manual re-run; draft→publish for first import |
| A4 | Catalogue overrides | P1 | Hide, recategorise, pin, rename; audited |
| A5 | Order search + full timeline | P0 | Every state change, notification, Stripe object, staff action |
| A6 | Refund (line / amount / full) | P0 | Policy limits by role; liability allocation; audited |
| A7 | Cancel on behalf | P0 | Voids the authorisation if not captured, else refunds |
| A8 | Disputes | P1 | Dispute list, evidence pack auto-assembled, submit before due date, alerts |
| A9 | Payouts: schedule, manual, holds | P1 | Balance check, idempotency, approval by a second admin above the threshold |
| A10 | Reconciliation report | P1 | Daily auto-run; mismatches listed; monthly close export (CSV) |
| A11 | User management + roles | P0 | Invite, deactivate, MFA enforced for staff |
| A12 | Audit log viewer | P1 | Filter by actor, target, action |
| A13 | Feature flags / kill switches | P0 | Global checkout off, per-merchant pause, delivery on/off |

### 4.4 System

| ID | Use case | P |
|---|---|---|
| X1 | Catalogue delta sync every 15 min in store hours + nightly full sync with anomaly guard | P0 |
| X2 | Search projection kept in sync (outbox) + nightly rebuild with alias swap | P0 |
| X3 | Stripe webhooks processed exactly once | P0 |
| X4 | Auto-reject unaccepted orders; auto-cancel authorisations nearing expiry | P0 |
| X5 | Release expired slot holds; expire abandoned checkouts | P0 |
| X6 | Daily reconciliation + ledger invariants check | P1 |
| X7 | Transactional notifications with retries and delivery tracking | P0 |
| X8 | Data retention jobs (purge PII past retention) | P2 |

## 5. Out of scope (explicit)

Carts spanning several merchants · platform-funded coupons · subscriptions · marketplace-wide inventory · alcohol (until AGCO licensing is reviewed) · Quebec/French · native apps · merchant self-signup · B2B/invoicing.

## 6. Business model

**Revenue:**
- Tiered commission on each order's final item subtotal (from the brief): **20%** < $50 · **15%** $50–$100 inclusive · **10%** > $100.
- Optional: shopper service fee, delivery fee margin (v1.1).

**Variable costs per order** (Canadian list prices verified 2026-09-27; see [BLUEPRINT §3.7](../BLUEPRINT.md#37-stripe-facts-that-shape-the-design-verified-in-stripe-docspricing)):
- Card processing 2.9% + CA$0.30 of the charged total (paid by the platform with destination charges)
- Connect: CA$2 per monthly active account; 0.25% + CA$0.25 per payout
- Disputes: CA$15 each, plus the amount if lost
- Notifications (SMS ≈ $0.01–0.02 each), support time, refunds we absorb, disputes

### 6.1 Unit economics per pickup order (illustrative)

| Basket (items) | Commission | Stripe (≈2.9% + 30¢) | Contribution before support & fixed costs |
|---|---|---|---|
| $25.00 | $5.00 (20%) | $1.03 | **$3.97** |
| $49.99 | $10.00 (20%) | $1.75 | **$8.25** |
| $50.00 | $7.50 (15%) | $1.75 | **$5.75** |
| $60.00 | $9.00 (15%) | $2.04 | **$6.96** |
| $100.00 | $15.00 (15%) | $3.20 | **$11.80** |
| $100.01 | $10.00 (10%) | $3.20 | **$6.80** ← cliff |
| $120.00 | $12.00 (10%) | $3.78 | **$8.22** |

(Stripe fees in reality apply to the total including HST and deposits; the table simplifies.)

**Insights:**
1. **Tier cliffs.** The platform earns *less* on a $100.01 basket than on a $100.00 one, and less at $50.00 than at $49.99. Marginal tiers remove the cliff (20% of the first $50, 15% of the next $50, 10% above). **Business decision B2.**
2. Contribution per order is $4–12. One refunded-and-absorbed $10 item or one lost dispute ($15 dispute fee + goods) wipes out several orders' margin. So the liability matrix and fraud controls matter more than features.
3. Fixed monthly costs (~$400–700 infra + tools) break even at roughly **70–120 orders/month**, before people costs.

## 7. Assumptions to validate during the pilot

| Assumption | How we validate | Kill/pivot signal |
|---|---|---|
| Shoppers will pick up rather than need delivery | Pickup order volume, survey | < 30 orders/week after 4 weeks |
| Store staff can fulfil within 15 min acceptance / 2 h ready | Console timestamps | > 10% auto-rejects |
| Weighed-item estimates are within ±15% | Estimate vs. captured amount | > 5% of orders need over-capture handling |
| Out-of-stock rate at picking < 5% of lines | Unavailable-line rate | > 10% → need real inventory feed |
| Merchant sees incremental customers | % of our customers not in their existing shop's list (with consent) or new-customer survey | Merchant won't renew |

## 8. Success metrics

| Type | Metric | Pilot target |
|---|---|---|
| North star | Completed orders / week | 50 by week 6 of the pilot |
| Conversion | Checkout started → paid | ≥ 45% |
| Quality | Orders with a reported problem | ≤ 5% |
| Quality | Line fill rate (picked or accepted-substitute / ordered) | ≥ 95% |
| Ops | Median accept time / median ready time | ≤ 5 min / ≤ 90 min |
| Ops | Pickup wait after "I'm here" (industry average ≈ 5 min 21 s) | median ≤ 5 min, p90 ≤ 10 min |
| Quality | Pick accuracy (right item, right quantity) | ≥ 98% |
| Merchant | New-to-merchant customers per month (the value we sell) | tracked from week 1; target set with the merchant |
| Money | Ledger/Stripe reconciliation mismatches | 0 unexplained |
| Money | Dispute rate | < 0.5% |
| Retention | 30-day repeat rate | ≥ 30% |
| Tech | Checkout availability during store hours | ≥ 99.9% |

## 9. Release criteria (pilot go-live checklist)

- [ ] All P0 use cases pass UAT with merchant staff on real tablets
- [ ] Security review done; no open high/critical findings
- [ ] Reconciliation clean for 7 consecutive days on staging with test orders
- [ ] Merchant agreement, shopper Terms, Privacy Policy published
- [ ] Support process staffed during store hours; runbooks written
- [ ] Rollback plan and checkout kill switch tested
