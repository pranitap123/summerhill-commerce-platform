# ADR-0009: Sales tax (HST) calculation

- Status: **Accepted for the demo** (implemented in the `pricing` module, G2-05: per-line HST from `tax_code`, one HST line at checkout). The open questions below would need an accountant's answer only if this became a real business (out of scope, see the [plan](../IMPLEMENTATION_PLAN.md#out-of-scope-for-the-github-release))
- Date: 2026-09-27

## Context
In the upstream catalogue, 950 of 3,150 products are taxable at 13% (Ontario HST) and 2,200 are zero-rated basic groceries. The current checkout charges no tax. The merchant is seller of record (ADR-0005, `on_behalf_of`).

## Decision (proposed)
- Tax is calculated by our `pricing` module per line from the merchant-supplied `tax_code` (`HST_STANDARD`, `ZERO_RATED`), rounded half-up per line, and presented to Stripe Checkout as a single **HST** line item computed by us (so there's no rounding mismatch).
- HST collected on goods flows to the merchant inside the transfer; the merchant remits it. Receipts show the merchant's legal name and HST number.
- The platform's commission may itself attract HST (if the platform is registered). Controlled by `fee_schedules.hst_on_commission`; invoiced to merchants monthly.
- Stripe Tax is not used in v1 (single province, known codes); revisit for multi-province delivery.

## Research update (2026-09-27)
CRA guidance says registered vendors charge their own GST/HST on supplies made through a distribution platform; the platform operator collects and remits for **non-registered** vendors. Therefore:
- v1 onboards only HST-registered merchants and validates their registration number at onboarding and yearly.
- Before any non-registered merchant joins: the platform registers for GST/HST, and a `tax_collector = platform` path changes the transfer amount (HST stays with the platform) and the receipt wording.
- Separately, CRA **Part XX** platform reporting applies to sales of goods ([PAYMENTS §5](../domains/PAYMENTS_AND_MONEY.md#5-sales-tax-hst)).

## Open questions for the accountant
1. Confirm the reading above, and what registration-number validation is acceptable.
2. HST on commission: registration timing, invoice format, whether the fee is taken HST-inclusive.
3. Deposit tax treatment.
4. Part XX: which merchant data is sufficient for due diligence; filing set-up.
