# Feature Strategy and Roadmap

Status: Design exploration (v0.1) · Owner: Pranita Panchal · Updated 2026-09-29 · Parent: [PRD](PRD.md) · [BLUEPRINT](../BLUEPRINT.md)

> **Design exploration** ([documentation index](../README.md)). What was built is in the [plan](../IMPLEMENTATION_PLAN.md); features scheduled after v1.0.0 are in its Backlog section.

The [PRD](PRD.md) defines the pilot. This document answers **"what else should the product do, when, and what should it deliberately not do?"** Every feature is tied to a metric and an effort estimate, because a two-engineer team can't build everything a mature grocery platform has.

## 1. How we choose features

1. **Prove the core loop first.** Order → merchant fulfils → customer collects → money settles correctly. A feature that doesn't strengthen that loop waits until the pilot proves it works.
2. **Every feature names the metric it moves** (from [PRD §8](PRD.md#8-success-metrics)): conversion, basket size, repeat rate, fill rate, ops time, contribution margin, or merchant retention.
3. **Count the cost of ownership, not just the build.** Support load, legal exposure, money-handling complexity and operational burden count as much as engineer-weeks.
4. **Build the data model for later features now** when that's cheap (§6); build the features themselves later.
5. **Use data we already have.** The upstream feed contains useful fields we currently throw away (below).

**Scoring.** Impact (1–5) × Confidence (0.5–1.0) ÷ Effort (engineer-weeks, ew) gives a rough priority. The scores are inputs to a conversation, not a replacement for one.

### Data we already have that enables features

| Upstream field | Coverage | Enables |
|---|---|---|
| `avgWeight` | 199 of 263 per-lb items | Accurate estimates for weighed items (smaller hold, fewer surprises) |
| `healthClaims` | 283 products (9%): gluten-free 194, peanut-free 178, vegan 172, egg-free 167, kosher 152… | Dietary filters (with an allergen disclaimer) |
| `promotions` / `virtualCategory = specials` | 235 products | "Specials" landing page, sale badges, deal emails |
| `availableDays` | 6 (e.g. fresh sushi Mon–Sat) | Correct slot rules; "available tomorrow" messaging |
| `brand`, `organic` | all | Brand pages, organic filter |
| `LOCATION_ID` (request header) | catalogue is per store location | Multi-location merchants (§3.1) |
| Prepared Meals + Deli + Bakery | ~730 products (e.g. 47 "Global Inspired Meals", 35 "Signature Entrees", 30 "Cakes & Cupcakes") | Pre-orders, catering, lunch ordering (§3.7) |

## 2. Feature map

**Now** = add to the pilot (small, high leverage). **Next** = the first 3 months after the pilot (v1.1–v1.2). **Later** = after product-market-fit signals. Effort is in engineer-weeks (ew).

### A. Conversion and basket building (shopper)

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| Dietary and allergen filters (gluten-free, vegan, peanut-free, kosher, organic…) | **Now** | 0.5 | conversion | Mandatory disclaimer: "Based on supplier information. Always check the label." Never infer "contains X" from a missing claim |
| Specials page + sale badges + "was $X" pricing | **Now** | 0.5 | conversion, basket | Data already exists (235 items) |
| Unit-price display ($/100 g, $/lb) | **Now** | 0.25 | trust | Parse sizes from names; Ontario shoppers expect it |
| Accurate weighed-item estimates from `avgWeight` | **Now** | 0.25 | fewer disputes, smaller holds | Fall back to subcategory defaults for the 64 items without it |
| "Frequently bought together" / "complete your basket" | Next | 1.5 | basket size | Start with simple co-occurrence from orders; no ML needed |
| Minimum-order progress bar / small-basket fee | Next | 0.5 | margin | Depends on business decision B6 |
| Recipe or bundle pages ("Sunday roast for 4" → add all to cart) | Later | 2 | basket, SEO | Uses Payload pages; merchant-curated |
| Natural-language search ("gluten free snacks for kids") | Later | 2–3 | conversion | LLM query → structured filters; only once search analytics show demand |

### B. Retention and habit (shopper)

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Buy again** (items from past orders) | **Now** | 0.5 | repeat rate | Highest-value retention feature in grocery; cheap once order lines exist |
| Favourites / named shopping lists | Next | 1 | repeat rate | |
| Reorder a past order | Next | 0.5 | repeat rate | Already P1 in the PRD (S14) |
| Back-in-stock / "notify me when available" | Next | 1 | conversion | Triggered by the out-of-stock-today toggle and ingest changes |
| **Add items to an existing order** before picking starts | Next | 2 | basket, satisfaction | Very common grocery request; needs a second payment authorisation (§3.2) |
| Saved cards + express checkout | Next | 1 | conversion | Stripe Customer + SetupIntent |
| Recurring orders (weekly basket) | Later | 3 | repeat rate | Charges saved cards off-session; must handle failed payments and changes; only after "buy again" usage shows demand |
| Loyalty points | **Won't (for now)** | | | See §4 |
| Integration with the merchant's existing loyalty programme | Later (explore) | 2–3 | retention | The merchant already runs points through its vendor; shoppers will ask to earn them. Decision B12 |
| Slot-based pricing and a pickup/delivery pass (PC Express, Voilà pattern) | Later | 2 | margin, demand smoothing | Must follow the drip-pricing rules: fee shown at slot choice and in totals |

### C. Pickup experience

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **"I'm here" check-in** (button in the ready SMS/email + optional parking spot/car colour) | **Now** | 0.75 | pickup time, satisfaction | Alerts the console; staff bring the order out. Makes curbside pickup possible |
| Pickup by someone else (name on order) | **Now** | 0.25 | fewer failed handovers | Shown to staff alongside the pickup code |
| Live status + estimated ready time | Next | 1 | fewer "where is my order" contacts | Based on queue length and historic pick times |
| Pickup lockers / after-hours pickup | Later | – | | Only with merchant hardware |

### D. Merchant operations

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Bag labels / pick-slip printing** (order number, customer name, bag count, cold/frozen flags) | **Now** | 0.75 | handover errors | Browser print to a thermal label printer; big reduction in wrong-bag handovers |
| Sold-out-today for a whole category (e.g. "bakery sold out") | **Now** | 0.25 | fill rate | Extends the per-product toggle |
| **Barcode scan-to-verify + deli-label (GS1 variable-measure) scanning** | **Now** | 1.5 | pick accuracy ≥ 98% | Camera-based in the browser; the industry reaches ≈ 99.8% accuracy with scanning. See [ORDERS §6](../domains/ORDERS_AND_FULFILMENT.md#6-picking-weighing-and-substitutions) |
| Pick-path ordering (aisle/zone) | Next | 0.5 | pick time | Merchant maps categories to zones once |
| Automatic slot throttling (reduce capacity when the queue backs up) | Next | 1 | SLA, auto-rejects | |
| Merchant analytics: sales, top products, unavailability rate, accept/pick times, customer ratings | Next | 2 | merchant retention | The reason merchants stay |
| Multi-picker support (split a big order) | Later | 1.5 | pick time | Only when order volume needs it |
| POS / inventory integration (Lightspeed, Square, Shopify POS) | Later | 3–4 each | fill rate | The real fix for the useless stock flag; one per merchant demand |

### E. Merchant supply (growing from 1 to 10 merchants)

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Multi-location data model** | **Now** (model only) | 0.5 | future-proofing | §3.1. Cheap now, expensive to retrofit |
| CSV catalogue import + mapping UI | Next | 2 | merchants onboarded | Works for any merchant without an API |
| Stripe onboarding via Express/embedded components | Next | 1.5 | time to go live | ADR-0011 |
| Merchant self-serve application + vetting workflow | Later | 2 | | Admin-assisted onboarding until ~10 merchants |
| Catalogue enrichment (AI-drafted descriptions, merchant-approved) | Later | 1.5 | SEO, conversion | **Never** generate allergen, nutrition or health claims |
| Merchant-funded promotions in the console | Later | 2 | GMV | Needs the discount funding model (§3.4) |

### F. Revenue and margin

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| Configurable fee schedules (flat/marginal, per merchant, effective dates) | **Now** | (in M1) | margin | Already in the design |
| Small-basket fee / minimum order | Next | 0.5 | margin | Decision B6 |
| **Store credit as a refund option** (optionally with a small bonus) | Next | 2 | margin | Refunding to card loses Stripe's processing fee; credit keeps the customer. Needs a credit ledger and funding rules (§3.3) |
| Promo codes: platform-funded (acquisition) and merchant-funded | Next | 2.5 | acquisition, GMV | Changes the fee base and may need a top-up transfer (§3.4) |
| Gift cards | **Won't (for now)** | | | See §4 |
| Paid delivery membership | Later | 3 | repeat rate, margin | Only after delivery exists and repeat rate is proven |
| Sponsored products / brand advertising | Later | 3 | margin | Needs traffic first |

### G. Trust, safety and quality

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Order rating (1–5 stars + tags) after pickup** | **Now** | 0.5 | quality signal | Feeds merchant analytics; order-level, not product reviews |
| Product recall tool (find buyers by product and date range → notify) | Next | 1 | legal/safety | Listed in SECURITY §7.2; a real obligation |
| Merchant quality score (accept time, fill rate, issue rate, rating) | Next | 1 | quality | Used in merchant reviews and to rank merchants in search |
| Fraud: device fingerprinting, account linking, refund-abuse scoring | Later | 2 | loss rate | Radar + the refund engine cover the pilot |
| Product reviews | **Won't (for now)** | | | See §4 |

### H. Acquisition and CRM

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **SEO foundations**: indexable product/category/merchant pages, schema.org `Product`/`Offer` JSON-LD, sitemap, canonical URLs, meta via the Payload SEO plugin | **Now** | 0.75 | organic traffic | The cheapest acquisition channel; 3,150 indexable product pages |
| Marketing email with CASL-compliant consent (unticked opt-in, recorded) | **Now** (consent capture only) | 0.25 | list growth | Capture consent from day one; campaigns come later |
| Weekly specials email | Next | 1 | repeat rate | Uses promotions data; needs consent |
| Abandoned-cart reminder | Next | 0.75 | conversion | Only to users with marketing consent or as allowed under CASL; counsel to confirm |
| Referral programme (give $10, get $10) | Later | 2 | acquisition | Needs promo funding (§3.4) and fraud controls |
| Waitlist / "coming to your neighbourhood" pages | Later | 0.5 | demand data | Useful when choosing merchant #2's area |

### I. Data, analytics and experimentation

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Product analytics with consent** (PostHog/Plausible), with an event taxonomy for the funnel | **Now** | 0.75 | all metrics measurable | Without it we can't evaluate the pilot |
| Metrics dashboard for [PRD §8](PRD.md#8-success-metrics) (Metabase on a read-only replica) | **Now** | 0.5 | decisions | |
| A/B testing on top of the feature flags | Later | 1 | | Only once traffic makes results meaningful |
| Data warehouse / BI export | Later | 1.5 | | When SQL on a replica becomes too slow or messy |

### J. Internal tools

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| Read-only "view as customer" for support | Next | 1 | support time | Audited; never impersonates for write actions |
| Bulk tools (bulk refund after an incident, bulk notify) | Next | 1 | incident response | |
| Support reply drafting with an LLM, agent-approved | Later | 1 | support time | |

### K. Seasonal and new business lines

| Feature | When | Effort | Metric | Notes |
|---|---|---|---|---|
| **Holiday pre-orders** (turkeys, pies, platters) with long lead times | **Optional wedge for Christmas 2026** (deposit online, balance in store; [BLUEPRINT §4.3](../BLUEPRINT.md#43-go-to-market-wedge-holiday-pre-orders-decision-b11)); full version in v1.2 | 3–4 (wedge) / 2.5 (full) | GMV, merchant trust | The merchant takes pre-orders through Microsoft Forms today (verified). This is our most validated pain point | Specialty grocers commonly run large seasonal pre-orders. Payment design in §3.6 |
| Catering / office lunch ordering from prepared meals | Later (explore) | 3–4 | new revenue line | §3.7. Needs customer interviews first |
| Delivery via courier API | Next (v1.1) | 4–6 | reach | Already ADR-0010 |

## 3. Design notes for the non-obvious features

### 3.1 Multi-location merchants (do the data model now)
The scraper requests the catalogue with a `LOCATION_ID`, so prices, promotions and availability are per store. Many specialty grocers have 2–5 locations.

**Model:** `merchant` (legal entity, Stripe account, agreement) → `merchant_locations` (address, hours, slots, pickup instructions, catalogue connector config). Products, overrides, slots and orders reference a `location_id`.

- **Now:** add `merchant_locations`, with one row for Summerhill, and reference it everywhere instead of `merchant_id` where the meaning is "a store".
- **Later:** a location picker in the storefront and per-location catalogues.

Retrofitting this after launch would touch every table and query.

### 3.2 Add items to an existing order
- Allowed while the status is `placed` or `accepted`, and before `pick_started_at`.
- Each addition gets its own Checkout session or PaymentIntent (a new card authorisation) linked to the order through `order_payments`.
- At capture, the final total is allocated across the linked authorisations. The platform fee is calculated on the **combined** item subtotal (one tier for the whole order), and each PaymentIntent's `application_fee_amount` is set pro rata.
- Removing an item needs no payment action; the capture is simply smaller.
- Cut-off shown to the customer: "You can add items until 30 min before your slot."

### 3.3 Store credit
- `finance.customer_credit_ledger`: grants (refund, goodwill, promotional) and redemptions. The balance is a platform **liability**.
- At checkout, credit reduces the amount charged to the card, but the merchant must still receive the full amount minus the fee. If `credit > fee`, a destination charge can't cover it, so the platform sends a **separate top-up transfer** from its balance to the merchant (the same mechanism as §3.4).
- Legal: credit issued as a refund alternative must be optional for the customer and must not be sold (selling it would make it a gift card; §4). Get counsel's review.

### 3.4 Promotions and who funds them
| Funded by | Fee base | Money mechanics |
|---|---|---|
| Merchant (e.g. "10% off cheese") | Price after the discount | Plain destination charge on the discounted amount |
| Platform (e.g. "$10 off your first order") | Price **before** the discount (the merchant shouldn't lose out) | The charge is smaller; if `platform discount > commission`, the platform sends a top-up transfer to the merchant |

- Every discount is stored as an order line with `funded_by` and `promotion_id`, so statements and reconciliation stay exact.
- Stripe's `application_fee_amount` can't be negative. That's why the top-up transfer path is needed.

### 3.5 "I'm here" check-in
- A signed link in the ready notification → the order gets an `arrived_at` timestamp plus an optional parking-spot note → the console shows a high-priority banner with a sound.
- The time from arrival to handover is tracked as an ops metric.
- No location tracking; the customer taps a button.

### 3.6 Holiday pre-orders (long lead time)
Card authorisations expire after about 7 days, so a pickup 3 weeks away can't rely on the normal authorise-then-capture flow.

- **Option A (recommended):** save the card at checkout (SetupIntent); authorise it off-session **48 hours before pickup**, then capture after picking as usual. If the authorisation fails, send the customer a payment link, and release the order 24 hours before pickup if it isn't fixed.
- **Option B:** charge a deposit immediately (e.g. 30%) and the balance at pickup. More refund work; simpler for high-value items such as turkeys.

Other requirements:
- Per-product `preorder_window` (open/close dates) and `max_preorder_qty`.
- Dedicated pickup days with their own capacity.
- A production report for the merchant (quantity per item per day).

### 3.7 Catering and office lunch (explore before building)
The catalogue has ~290 prepared-meal products and ~250 deli products. Office orders mean:
- large quantities, next-day lead times, a delivery requirement
- invoice or company-card payment, sometimes needing Stripe invoicing
- tax receipts for businesses

This is a separate go-to-market. Interview 10 office managers before committing engineering time.

## 4. What we will deliberately **not** build (and why)

| Feature | Why not (now) | Revisit when |
|---|---|---|
| Native iOS/Android apps | A PWA covers the pilot; apps double the frontend work and add app-store review | Repeat rate > 40% and push notifications are a proven need |
| Own delivery fleet | Driver employment, insurance, dispatch; courier APIs cover the need | Delivery volume makes courier fees the largest cost |
| Loyalty points | Merchants have their own programmes; creates a financial liability; weak signal at small scale | 10+ merchants and a proven repeat-purchase habit |
| Gift cards | Ontario gift-card rules (no expiry, no fees), breakage accounting, fraud target | Strong seasonal demand from merchants |
| Product reviews | Low value for groceries, moderation cost, legal risk (health claims in reviews) | Never likely; order ratings cover quality |
| Mixed-merchant carts | Changes the charge model and tax (ADR-0005) | Merchant #3+ and data showing cross-shopping |
| Dynamic / surge pricing on products | Damages trust with grocery shoppers (slot fees are different, see §2B) | Not planned |
| In-store hardware (smart carts, pick-to-light shelf tags) | Capital cost and installation in someone else's store | Merchant with high online volume asks for it |
| Small-basket / service fees shown only at checkout | Illegal drip pricing under the Competition Act since 2024 | Never; use a minimum order or all-in prices |
| 24/7 live chat | Can't staff it; email + in-order issue reporting is enough for pickup | Delivery launch or evening volume |
| Buy-now-pay-later | Tiny baskets; fees higher than the margin | Average basket > $150 |
| French localisation | Toronto-only; Quebec Law 25 obligations | Expansion to Quebec |

## 5. Pilot scope change (recommended)

Add these **"Now"** items to the pilot. Together they're ≈ **8.75 engineer-weeks**, or about **+4.5 weeks** of calendar time with 2 engineers.

| Item | Effort | Milestone |
|---|---|---|
| Multi-location data model | 0.5 | M0/M1 |
| Accurate weighed-item estimates from `avgWeight` | 0.25 | M2 |
| Dietary/allergen filters + disclaimer | 0.5 | M2 |
| Specials page + sale badges | 0.5 | M2 |
| Unit-price display | 0.25 | M2 |
| SEO foundations | 0.75 | M2 |
| Buy again | 0.5 | M3 |
| "I'm here" check-in + alternate pickup person | 1.0 | M3 |
| Bag labels / pick slips + category sold-out | 1.0 | M3 |
| Barcode scan-to-verify + deli-label scanning (added after research) | 1.5 | M3 |
| Order rating | 0.5 | M3 |
| Product analytics with consent + marketing-consent capture + metrics dashboard | 1.5 | M1/M5 |
| **Total** | **≈ 8.75** | |

To limit the slip, **cut** the optional "substitution approval by SMS" (S10, ≈ 1 ew); live replacement updates on the order page cover it. The net addition is then ≈ 7.75 ew, about **+4 weeks** with 2 engineers. Together with the work found in the completeness audit, the public pilot lands at **≈ 29 March 2027** (schedule options: [BLUEPRINT B16](../BLUEPRINT.md#11-decisions-only-the-business-can-make)). Scanning shouldn't be deferred: it's the main lever on pick accuracy.

## 6. Build now to make later features cheap

| Build into the data model now | Unlocks later |
|---|---|
| `merchant_locations` | Multi-location merchants (§3.1) |
| `orders.fulfilment_type` (`pickup` \| `delivery`) | Delivery |
| `order_payments` (an order can have several PaymentIntents) | Add-to-order, pre-orders, payment retries |
| Discount lines with `funded_by` + `promotion_id` | Promo codes, merchant promos, referrals |
| `finance.transfers` supporting standalone top-up transfers | Store credit, platform-funded promos |
| `consents` table (type, version, source, timestamp) | CASL-compliant marketing, analytics consent |
| Analytics event taxonomy (`product_viewed`, `added_to_cart`, `checkout_started`, `order_placed`, `order_collected`…) | Funnels, recommendations, experiments |
| `products.preorder_window`, `max_preorder_qty` (nullable) | Holiday pre-orders |
| Stripe Customer created for account holders | Saved cards, recurring orders |

## 7. Post-pilot sequencing (proposal)

| Release | Target | Contents | Effort |
|---|---|---|---|
| v1.1 | April 2027 | Delivery via courier API, saved cards, reorder, favourites/lists, back-in-stock, weekly specials email | ≈ 10 ew |
| v1.2 | May 2027 | Merchant #2 (CSV import), Express onboarding, merchant analytics, add-to-order, holiday pre-orders (ready well before Canadian Thanksgiving, 11 Oct 2027) | ≈ 12 ew |
| v1.3 | Q2 2027 | Promo codes + funding model, store credit, recall tool, merchant quality score, "frequently bought together" | ≈ 10 ew |
| Explore | Q2 2027 | Catering/office discovery interviews; POS integration for the highest-volume merchant | discovery |

Each release is re-prioritised using pilot data. The scores in §2 are hypotheses, and the pilot is how we test them.
