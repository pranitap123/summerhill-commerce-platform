# Payments, Fees, Tax and Money Flow

Status: v1.0 (built in G2 and G5, Stripe test mode) · Updated 2026-09-29 · Parent: [BLUEPRINT](../BLUEPRINT.md)

> **Design + current** ([documentation index](../README.md)). The money flows below are built and tested in Stripe test mode and the payment simulator. The accountant and legal reviews called for here would apply only to a real launch (out of scope).
**Review required by an accountant (tax sections) and by whoever signs the Stripe platform agreement.** Stripe capabilities and fees were verified against Stripe's documentation and Canadian pricing pages on 2026-09-27 (sources: [BLUEPRINT §14](../BLUEPRINT.md#14-sources)); re-verify before contracting.

## 1. Principles

1. Integer cents, CAD only in v1. Any other currency is rejected at the boundary.
2. Every amount the customer pays is computed by `pricing`, stored on the order, and never recomputed from current prices after placement.
3. A card is **authorised** at checkout and **captured** after picking, for the final amount.
4. Every money movement produces ledger entries; Stripe and our ledger are reconciled daily.
5. Every Stripe call that creates or moves money carries an idempotency key derived from our IDs (`capture:{orderId}`, `refund:{refundId}`).

## 2. Charge model

See [ADR-0005](../adr/0005-charge-model.md).

- **Destination charge** created on the platform with `transfer_data.destination = merchant account`, `application_fee_amount = platform fee`.
- **`on_behalf_of = merchant account`**, so the merchant is the settlement merchant. Their name appears on the card statement and they are the seller of record (needed for HST).
- **Single merchant per order** (destination charges support one destination). Mixed-merchant baskets in the future would need separate charges and transfers, with the platform as merchant of record, and that changes tax treatment.
- **Hosted Stripe Checkout** keeps us in PCI SAQ A scope; `payment_intent_data.capture_method = 'manual'`.
- Checkout line items are generated from our quote: item lines, one **HST** line (our computed amount, so Stripe's rounding can never differ from ours), deposits, and a line "**Weighed-item hold, released after weighing**".

## 3. Authorise, then capture

```mermaid
sequenceDiagram
  autonumber
  participant C as Customer
  participant App as App (checkout)
  participant S as Stripe
  participant WH as Webhook worker
  participant M as Merchant console
  participant J as Capture job
  C->>App: POST /checkout (quote_hash, slot, Idempotency-Key)
  App->>App: re-quote, validate, hold slot, create order pending_payment
  App->>S: checkout.sessions.create(manual capture, on_behalf_of, transfer_data, application_fee_amount = fee on ESTIMATE, metadata.order_id)
  C->>S: pays → card AUTHORISED for estimate + buffer
  S->>WH: checkout.session.completed
  WH->>WH: order → placed; payment row status=requires_capture
  M->>App: accept → pick → weigh/substitute → complete picking
  App->>J: enqueue payment.capture(orderId)
  J->>J: final quote from pick records; final fee on FINAL subtotal
  J->>S: paymentIntents.capture(amount_to_capture = final, application_fee_amount = final fee, idempotencyKey capture:{orderId})
  S-->>J: succeeded (remainder of hold released automatically)
  J->>J: order → ready; ledger entries; notify customer
```

**Card-network extensions** (verified in Stripe docs, 2026-09-27; each needs **IC+ pricing or Stripe approval**, which is decision B14):

| Feature | Checkout parameter (`payment_method_options.card`) | Grocery availability | How we use it |
|---|---|---|---|
| Overcapture | `request_overcapture: if_available` | Visa "all other categories" +15%; Amex grocery +15%; **not Mastercard** (US restaurants only) | If final > authorised, capture up to `overcapture.maximum_amount_capturable` instead of absorbing the difference |
| Incremental authorisation | `request_incremental_authorization: if_available` | Visa, Mastercard, Amex: all categories | "Add items to my order" raises the same hold (≤ 10 increments). Falls back to a second PaymentIntent |
| Extended authorisation | `request_extended_authorization: if_available` | Mastercard: all categories; Visa "other" categories: 30 days, **+0.08%** fee; Amex/Discover: not grocery | Pre-orders more than 5 days out without a deposit, when enabled |

- Always read `payment_method_details.card.capture_before`, plus the `overcapture`, `incremental_authorization` and `extended_authorization` status fields on the charge. Store them on `payments` and drive behaviour from them, never from assumptions about card brand.
- The capture call can set `application_fee_amount` (capped at the captured amount). That confirms the fee-on-final-amount design.
- Checkout `custom_text` explains holds: "Weighed items are estimated. We place a temporary hold and charge only the final amount after your order is packed."

**Rules and edge cases**

| Case | Handling |
|---|---|
| Final > authorised | If overcapture is available, capture up to its maximum. Otherwise capture the authorised amount and absorb the difference per [ORDERS §6](ORDERS_AND_FULFILMENT.md#6-picking-weighing-and-substitutions). The console prevents this in most cases |
| Final = 0 (everything unavailable) | Cancel the PaymentIntent (void); order → `cancelled` |
| Capture API error | Retry with the same idempotency key; after 5 failures → `payment_issue`, page on-call |
| Authorisation expiry | Online card authorisations are cancelled by Stripe after **7 days**. Slots are limited to 5 days ahead; `authExpiryGuard` alerts at day 5 |
| Fee tier changes between estimate and final | Expected. The fee is always computed on the **final** item subtotal |
| Customer cancels before acceptance | `paymentIntents.cancel`; no fee, no Stripe processing fee on an uncaptured authorisation |

## 4. Platform fee

### 4.1 Base
Commission is charged on the **final item subtotal after promotions**. It **excludes** HST, deposits, delivery fees and tips (Q: B3/B6 may add a service fee).

### 4.2 Tiers (per the brief)

| Final item subtotal | Rate |
|---|---|
| > $100.00 | 10% |
| $50.00 – $100.00 inclusive | 15% |
| < $50.00 | 20% |

`fee = round_half_up(subtotal × rate)`; `merchant_transfer = captured_total − fee`, so the amounts always sum exactly.

### 4.3 The cliff problem (business decision B2)

| Subtotal | Flat tiers (brief) | Marginal tiers (alternative) |
|---|---|---|
| $25.00 | $5.00 | $5.00 |
| $49.99 | $10.00 | $10.00 |
| $50.00 | **$7.50** | $10.00 |
| $77.56 | $11.63 | $14.13 |
| $100.00 | **$15.00** | $17.50 |
| $100.01 | **$10.00** | $17.50 |
| $120.00 | $12.00 | $19.50 |
| $200.00 | $20.00 | $27.50 |

The flat tiers cause the platform to earn less when a basket grows past $50 or $100. That creates perverse incentives (a merchant could be tempted to split orders; the platform would prefer $100.00 baskets to $100.01). Marginal tiers ("20% on the first $50, 15% on the next $50, 10% above") are continuous. **The code supports both** through `finance.fee_schedules(id, merchant_id NULL, mode 'flat'|'marginal', tiers jsonb, effective_from)`. Each order snapshots `fee_schedule_id` and `fee_rate_bp`.

### 4.4 Platform costs per order (verified Canadian list prices, 2026-09-27)

| Cost | Rate | Worked example ($78.21 order, $66.58 to merchant) |
|---|---|---|
| Card processing | 2.9% + CA$0.30 | $2.57 |
| Connect payout fee (platform handles pricing) | 0.25% + CA$0.25 **per payout** | ≈ $0.17 variable + the fixed $0.25 shared across the day's orders |
| Connect active account | CA$2 per monthly active account | fixed, per merchant |
| Dispute | CA$15 per dispute + the disputed amount if lost | only on disputes |
| Extended authorisation (if used) | +0.08% (Visa "other" categories) | pre-orders only |

Worked-example platform contribution after payout fees: ≈ **$8.85** (vs. $9.06 before them). With daily payouts, the fixed payout fee is ≈ CA$7.50/month per merchant; weekly payouts ≈ CA$1.

### 4.5 HST on the commission (B3, needs an accountant)
If the platform is an HST registrant (mandatory above $30k of taxable supplies in four consecutive quarters, or voluntary), the commission is a taxable service to the merchant. Model: `application_fee = commission + 13% HST on commission`; the platform issues a monthly tax invoice; the merchant claims input tax credits. `fee_schedules.hst_on_commission` toggles it.

## 5. Sales tax (HST)

See [ADR-0009](../adr/0009-sales-tax.md).

- The **merchant is the seller of record** (`on_behalf_of`) and remits the HST collected on its goods. The platform calculates and displays it, and passes the HST to the merchant inside the transfer.
- Tax per line from the merchant-supplied `tax_code` (`HST_STANDARD` 13% Ontario, `ZERO_RATED` basic groceries). In our data: 950 taxable, 2,200 zero-rated.
- Rounding: per line, half-up to the cent; the order tax = sum of line taxes. The receipt shows each taxable line flagged, the HST total and the **merchant's HST registration number** (a required merchant setting before go-live).
- Deposits: shown separately; the tax treatment follows merchant configuration.
- Delivery fee (v1.1): taxable at 13%.
- **GST/HST distribution-platform rules** *(CRA guidance, verified)*: registered vendors charge and collect their own GST/HST on sales made through a platform; the **platform must collect and remit for non-registered vendors**.
  - v1 policy: onboard only HST-registered merchants and validate their registration number (CRA GST/HST registry lookup) at onboarding and yearly.
  - Before accepting any small, non-registered merchant: register the platform for GST/HST, and route that merchant's tax to the platform (a `merchants.tax_collector = platform` flag changes the transfer amount and the receipts).
- **CRA Part XX platform reporting** *(verified)*: sale of goods is a reportable activity.
  - Collect each merchant's legal name, address, TIN/BN and jurisdiction during onboarding.
  - Keep per-merchant yearly totals: number of sales, consideration, fees withheld.
  - File the XML return by **31 January** for the previous calendar year.
  - A merchant is excluded only with < 30 sales **and** ≤ $2,800 in the year.
  - Implemented as the `finance.partxx_annual` job + report ([SECURITY §7.2](../SECURITY_AND_COMPLIANCE.md#72-obligations-canadaontario-to-be-confirmed-by-counsel)).
- **Stripe Tax is not used in v1:** single province, merchant-supplied codes, and exact control of rounding. Revisit with delivery across provinces.

## 6. Refunds

`stripe.refunds.create({ payment_intent, amount, reverse_transfer, refund_application_fee, metadata:{ refund_id, order_id, liability } }, { idempotencyKey: 'refund:'+refundId })`

| Liability (per [ORDERS §9](ORDERS_AND_FULFILMENT.md#9-liability-matrix)) | `reverse_transfer` | `refund_application_fee` | Who bears it |
|---|---|---|---|
| Merchant | true | true | Merchant loses its share; platform gives back its commission on that amount (proportional) |
| Platform | false | false | Platform pays the whole refund from its balance |
| Split (goodwill) | true, on a partial amount | true | Custom split recorded in `refunds.allocation` |

- Refund amount = line total + that line's HST (+ deposit). Partial weights are refunded pro rata.
- Stripe does not return its processing fee on refunds; the platform absorbs it (a tracked cost).
- Refund limits by role: support ≤ $50 per order without approval; above that `finance`/`admin`.
- `charge.refunded` / `refund.updated` / `refund.failed` webhooks confirm; the ledger is written on confirmation.

## 7. Disputes (chargebacks)

- With destination charges the **platform** is debited for the disputed amount plus Stripe's dispute fee (**CA$15**, verified 2026-09-27).
- Webhook `charge.dispute.created` → `finance.disputes` row → alert → an **evidence pack** is auto-assembled: order timeline, pickup code verification timestamp and staff member, IP/device at checkout, receipt, customer communications.
- Submit before `evidence_details.due_by` (alerts at 72 h and 24 h before).
- Recovery from the merchant per the liability matrix through a transfer reversal.
- **Prevention:** Radar rules, require CVC and postal code checks, 3DS when Radar recommends it, velocity limits (§SECURITY), and a clear statement descriptor ("SUMMERHILL MKT via SHMP").

## 8. Payouts

- Merchant payouts run on Stripe's automatic schedule: **daily**, with a **7-day delay for the first 30 days** of a new merchant (covers early refunds and disputes), then Stripe's standard delay.
- A manual payout (admin) requires: available balance ≥ amount, `Idempotency-Key`, reason, and **second-admin approval above $5,000**.
- `payout.paid` / `payout.failed` webhooks → `finance.payouts`; failures alert ops and show in the merchant console.
- **Negative balance risk:** transfer reversals can fail if the merchant has already been paid out. Mitigations: the payout delay above, reserves for high-dispute merchants, and recovering through future transfers (netting). The platform is ultimately liable to Stripe for connected-account negative balances with Custom/Express accounts.

## 9. Ledger

Double-entry, append-only (`finance.ledger_entries`, INSERT-only grant). Accounts:

| Account | Meaning |
|---|---|
| `stripe_clearing` | Money on the platform's Stripe balance attributable to orders |
| `merchant_payable:{id}` | Owed to or transferred to a merchant |
| `platform_fee_revenue` | Commission |
| `hst_on_commission_payable` | If B3 = yes |
| `processing_fee_expense` | Stripe fees |
| `refund_expense_platform` | Refunds borne by the platform |
| `dispute_expense` | Dispute amounts and fees borne by the platform |

**Worked example.** A real basket with catalogue prices:

| Line | Estimate | Actual (after picking) | Tax |
|---|---|---|---|
| Bananas 2.00 lb est. @ $1.49/lb | $2.98 | 2.20 lb → **$3.28** | zero-rated |
| Heritage Eggs XL 1 dozen | $10.99 | **$10.99** | zero-rated |
| Chips × 2 @ $4.99 | $9.98 | only 1 available → **$4.99** | 13% HST |
| Rib steak 1.50 lb est. @ $35.99/lb | $53.99 | 1.62 lb → **$58.30** | zero-rated |
| **Item subtotal** | **$77.94** | **$77.56** | |
| HST | $1.30 | **$0.65** | |
| Weighed-item hold (15% of $56.97) | $8.55 | released | |
| **Authorised / captured** | **$87.79** | **$78.21** | hold released: $9.58 |

- Fee: $77.56 is in the 15% tier → **$11.63**
- Merchant transfer: $78.21 − $11.63 = **$66.58**, which includes the $0.65 HST the merchant remits
- Stripe processing fee (≈2.9% + 30¢ of $78.21): **$2.57**, paid by the platform
- Platform contribution: $11.63 − $2.57 = **$9.06**

Journal:

| Event | Debit | Credit | Amount |
|---|---|---|---|
| Capture | stripe_clearing | merchant_payable:1 | 66.58 |
| | stripe_clearing | platform_fee_revenue | 11.63 |
| Automatic transfer | merchant_payable:1 | stripe_clearing | 66.58 |
| Stripe fee | processing_fee_expense | stripe_clearing | 2.57 |
| **Net `stripe_clearing`** | | | **9.06** = platform balance movement ✔ |

## 10. Reconciliation and close

**Daily (06:00):**
1. Pull the previous day's balance transactions for the platform account and each connected account.
2. Match them by `charge`/`transfer`/`refund`/`payout`/`application_fee` id to our `payments`, `refunds`, `payouts` and ledger.
3. Check the invariants:
   - `fee + merchant_transfer = captured`
   - sum of line totals + tax + deposits = captured
   - ledger balances per order
   - no order `ready`/`collected` without a captured payment
   - no captured payment without an order
4. Unmatched items or differences > 0 cents → alert `#finance-alerts` and add them to the reconciliation report.

**Monthly:**
- Merchant statements: GMV, refunds by liability, commission, HST on commission, disputes, net transfers, payouts.
- Accounting export (CSV → QuickBooks/Xero): revenue, expenses, payables.
- Revenue recognition: commission recognised at capture, reduced by fee refunds.

## 11. Stripe account configuration checklist

- Separate **test** and **live** platform accounts/keys per environment; restricted keys where possible.
- Webhook endpoints: platform events and **Connect** events, each with its own signing secret.
- Branding and statement descriptor; Connect settings (Express/Custom branding, payout schedule defaults).
- Radar rules (see [SECURITY](../SECURITY_AND_COMPLIANCE.md#6-fraud-and-abuse)).
- API version pinned in code (`2025-08-27.basil` today); upgraded deliberately with a test run.

## 12. Implementation notes (G5)

Built 2026-09-28 (`payments`, `payouts` modules). Stripe's destination-charge semantics were checked against Stripe's documentation: the **full** charge is transferred to the connected account and the application fee is collected back; `reverse_transfer` reverses the transfer in proportion to the refund (for a destination charge that is the refund amount) and `refund_application_fee` returns the fee in the same proportion.

| Topic | Design above | As built |
|---|---|---|
| Refund calls (§6) | Flags per liability | merchant: refund `{reverse_transfer, refund_application_fee}`; platform: refund `{}`; split: refund `{}` **plus** a transfer reversal of the merchant share with `refund_application_fee` (the refund API can't reverse only part of the transfer). Idempotency keys `refund:{id}` and `refund-reversal:{id}` |
| Refund ledger (§6, §9) | Written on confirmation | Posted when Stripe says `succeeded` (at once for card refunds in test mode, else via `refund.updated`): the merchant share as a pass-through pair (paid out, pulled back), the platform share to `refund_expense_platform`, the returned commission as a debit to `platform_fee_revenue` (and `hst_on_commission_payable` in proportion). A refund that fails later gets an exact reversing journal and an alert. One refund at a time per order |
| Fee refunded | Proportional | Read back from Stripe (the application fee's `amount_refunded`), never assumed; the simulator and test fake use the same proportional rule |
| Disputes (§7) | Row, alert, evidence, recovery | `charge.dispute.*` webhooks; `dispute_expense` debited amount + fee; evidence pack from our records (timeline, handover record with the verified pickup code and staff id, receipt, emails; checkout IP/device isn't stored in v1 and the pack says so); alerts at 72 h and 24 h; merchant recovery by transfer reversal credits `dispute_expense`; `funds_reinstated` credits it back |
| Payouts (§8) | Balance, key, reason, approval > $5,000 | As designed; the four-eyes rule is also a database CHECK. `payout.*` Connect webhooks update or create rows (automatic payouts); failures alert. No polling job |
| Reconciliation (§10) | Daily 06:00 | Hourly job that runs once per business day after 06:00 Toronto. Charges, refunds, refund failures and dispute debits/reinstatements are matched by id and amount (and the Stripe fee on charges; a fee unknown at capture is posted here). Transfers, application fees and payouts are the mechanics of destination charges and are counted, not matched. Six invariants run over all orders. Report at `/ops/reconciliation`; monthly close CSV of every ledger entry |
| Statements (§10) | Monthly per merchant | Built from the ledger journals of the merchant's orders: sales, commission, HST on commission, refunds the merchant bore, commission returned, refunds the platform bore, dispute recoveries, net transfers, payouts. JSON/CSV in `/ops`, and for owners in the store console |
| Connected accounts | – | Custom by default, Express optional ([ADR-0012](../adr/0012-custom-accounts-by-default.md), [ADR-0011](../adr/0011-connect-account-type.md)) |
