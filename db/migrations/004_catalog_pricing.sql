

ALTER TABLE catalog.products ADD COLUMN unit_price_cents bigint;
UPDATE catalog.products SET unit_price_cents = round(price * 100)::bigint;
ALTER TABLE catalog.products
  ALTER COLUMN unit_price_cents SET NOT NULL,
  ADD CONSTRAINT products_unit_price_cents_check CHECK (unit_price_cents >= 0);
DROP INDEX catalog.idx_products_price;
ALTER TABLE catalog.products DROP COLUMN price;
CREATE INDEX idx_products_unit_price_cents ON catalog.products(unit_price_cents);

ALTER TABLE catalog.products
  ADD COLUMN pricing_model text NOT NULL DEFAULT 'each' CHECK (pricing_model IN ('each', 'per_weight')),
  ADD COLUMN unit text NOT NULL DEFAULT 'ea' CHECK (unit IN ('ea', 'lb')),

  ADD COLUMN sell_by text NOT NULL DEFAULT 'quantity' CHECK (sell_by IN ('quantity', 'weight')),

  ADD COLUMN estimated_weight_lb numeric(8, 3) CHECK (estimated_weight_lb > 0),
  ADD COLUMN weight_step_lb numeric(6, 3) NOT NULL DEFAULT 0.25 CHECK (weight_step_lb > 0),
  ADD COLUMN min_weight_lb numeric(6, 3) NOT NULL DEFAULT 0.5 CHECK (min_weight_lb > 0),
  ADD COLUMN tax_code text NOT NULL DEFAULT 'ZERO_RATED' CHECK (tax_code IN ('ZERO_RATED', 'HST_STANDARD')),
  ADD COLUMN deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),

  ADD COLUMN min_qty integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  ADD COLUMN max_qty integer NOT NULL DEFAULT 0 CHECK (max_qty >= 0),

  ADD COLUMN available_days smallint[] NOT NULL DEFAULT ARRAY[]::smallint[]
    CHECK (available_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  ADD CONSTRAINT products_unit_matches_model CHECK (
    (pricing_model = 'each' AND unit = 'ea' AND sell_by = 'quantity')
    OR (pricing_model = 'per_weight' AND unit = 'lb')
  );

CREATE TABLE catalog.promotions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id       bigint NOT NULL REFERENCES merchant.merchants(id),
  external_id       text,
  product_id        text NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'price_override' CHECK (kind IN ('price_override')),
  sale_price_cents  bigint NOT NULL CHECK (sale_price_cents >= 0),
  label             text NOT NULL DEFAULT 'Special',
  starts_at         timestamptz,
  ends_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  UNIQUE (merchant_id, product_id, external_id)
);
CREATE INDEX idx_promotions_product_id ON catalog.promotions(product_id);
CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON catalog.promotions
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

ALTER TABLE merchant.merchants
  ADD COLUMN accepting_orders       boolean NOT NULL DEFAULT true,
  ADD COLUMN min_order_cents        bigint NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),

  ADD COLUMN weight_buffer_bp       integer NOT NULL DEFAULT 1500 CHECK (weight_buffer_bp BETWEEN 0 AND 5000),
  ADD COLUMN hst_registration_number text;
