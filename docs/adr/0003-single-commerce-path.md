# ADR-0003: One commerce path; remove the Payload ecommerce plugin's commerce features

- Status: Accepted, implemented 2026-09-27 (G2-15)
- Date: 2026-09-27

## Context
The codebase contains two checkout systems:
1. The Payload ecommerce plugin (beta): its own products, variants, carts, orders, transactions, addresses and Stripe adapter/webhook.
2. Our custom `/api/checkout`, built on the Postgres catalogue with Stripe Connect destination charges and a tiered application fee.

Our catalogue is ingested outside Payload. We need manual capture, `on_behalf_of`, a per-order application fee recomputed at capture, weighed items, substitutions and slots. None of these are in the plugin's model without heavy customisation.

## Decision
Keep the custom path and build orders, payments and fulfilment as our own modules. Remove the plugin's commerce collections, its Stripe adapter and the template pages that depend on them (`checkout/confirm-order`, `orders`, `find-order`, `account/addresses` are rebuilt on our modules). Keep Payload for users/auth, pages, media, header/footer, SEO and forms.

## Consequences
- \+ One order model, one webhook pipeline, one source of truth.
- − We own more code (cart, orders), which is our core domain anyway.
- − Migration: drop the plugin's tables once no data depends on them (none in production).

## Implementation (G2-15)
- Removed: `@payloadcms/plugin-ecommerce` and its Stripe adapter, the `Products` collection, the template seed, the Archive/Carousel/ThreeItemGrid product blocks, the template checkout, confirm-order, address and plugin order pages and their components, and the template tests. `payload-types.ts` was regenerated.
- Rebuilt on our modules: cart (`/cart`), order status (`/orders/{publicId}`), order history (`/orders`), account (`/account`) and guest lookup (`/find-order`).
- Existing local Payload databases: `npm run payload:cleanup` drops the plugin's empty tables and enums (`db/payload/drop-ecommerce-plugin.sql`). Without it, Payload's dev schema push stops at an interactive "enum created or renamed?" prompt.

