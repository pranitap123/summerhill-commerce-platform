# ADR-0005: Destination charges with on_behalf_of, manual capture, single-merchant carts

- Status: Accepted, implemented 2026-09-27 (G2-07, G2-10); overcapture and incremental authorisation are requested `if_available`
- Date: 2026-09-27

## Context
- The final amount of a grocery order is only known after picking: 263 products are priced by weight, and out-of-stock items and substitutions are discovered at picking.
- The merchant must be seller of record for HST.
- The platform takes a tiered commission.
- The existing code already uses destination charges plus `application_fee_amount`, and has a demo of separate charges and transfers.

## Decision
- **Destination charges** on the platform, with `transfer_data.destination` = merchant and **`on_behalf_of` = merchant**.
- **`capture_method = manual`** through Stripe Checkout. Authorise estimate + weight buffer; capture the final amount after picking, with `application_fee_amount` recomputed on the final item subtotal.
- **One merchant per cart/order** in v1.
- Slots are limited to ≤ 5 days ahead because online card authorisations expire after about 7 days.

## Consequences
- \+ Customers pay the true final amount; no second charges; voids are free for cancellations before capture.
- \+ The merchant appears on the card statement; clean seller-of-record story.
- − Platform bears Stripe fees and dispute liability (priced into the commission; recovered through the liability matrix).
- − Mixed-merchant baskets need a future ADR (separate charges and transfers, with a different tax/merchant-of-record setup).
- − Over-capture beyond the authorisation isn't available in general; the weight buffer and the UI prevent it, and the rare remainder is absorbed.

## Alternatives
- Charge at checkout and refund differences: rejected; refunds cost the processing fee, look bad on statements, and under-charges can't be recovered.
- Separate charges and transfers for everything: more flexible, but the platform becomes merchant of record, which complicates HST. Kept for the multi-merchant future.
- Direct charges on the connected account: gives the platform less control over the customer experience and disputes; poorer fit for a marketplace brand.
