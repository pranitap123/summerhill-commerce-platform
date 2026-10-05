# ADR-0006: Money as integer cents with snapshotted prices, tax and fee

- Status: Accepted, implemented 2026-09-27 (G2-02, G2-05, G2-10)
- Date: 2026-09-27

## Decision
- All monetary values are `bigint` minor units + `char(3)` currency. No floats or `NUMERIC` dollars in the domain. Conversion from upstream decimals happens once at ingest, with validation.
- Rounding: half-up to the cent, per line (price × weight, tax per line). Order totals are sums of rounded lines.
- Orders snapshot unit prices, line totals, tax per line, `fee_schedule_id`, fee rate and fee amount. Later catalogue or fee changes never alter existing orders.
- Fee schedules are versioned (`finance.fee_schedules`, `mode flat|marginal`, `effective_from`).
- All money maths lives in the `pricing` and `payments` modules and is covered at 100% branches.

## Consequences
Migration of `catalog.products.price NUMERIC` → `unit_price_cents`. Display formatting happens only in the UI (`Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })`).
