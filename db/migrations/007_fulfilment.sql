

CREATE TABLE merchant.location_settings (
  location_id              bigint PRIMARY KEY REFERENCES merchant.locations(id),
  weekly_hours             jsonb NOT NULL DEFAULT '{
    "1": {"open": "08:00", "close": "21:00"}, "2": {"open": "08:00", "close": "21:00"},
    "3": {"open": "08:00", "close": "21:00"}, "4": {"open": "08:00", "close": "21:00"},
    "5": {"open": "08:00", "close": "21:00"}, "6": {"open": "09:00", "close": "20:00"},
    "7": {"open": "10:00", "close": "18:00"}}' CHECK (jsonb_typeof(weekly_hours) = 'object'),
  slot_minutes             integer NOT NULL DEFAULT 60 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
  slot_capacity            integer NOT NULL DEFAULT 5 CHECK (slot_capacity BETWEEN 1 AND 100),
  lead_time_minutes        integer NOT NULL DEFAULT 120 CHECK (lead_time_minutes BETWEEN 0 AND 10080),

  paused                   boolean NOT NULL DEFAULT false,
  pause_reason             text CHECK (char_length(pause_reason) <= 200),

  scale_barcode            jsonb NOT NULL DEFAULT '{"itemDigits": 5, "valueDigits": 5, "priceCheckDigit": false, "value": "price"}'
                           CHECK (jsonb_typeof(scale_barcode) = 'object'),
  updated_by               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_location_settings_updated_at BEFORE UPDATE ON merchant.location_settings
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

INSERT INTO merchant.location_settings (location_id) SELECT id FROM merchant.locations;

CREATE TABLE merchant.location_closures (
  location_id  bigint NOT NULL REFERENCES merchant.locations(id),
  closed_on    date NOT NULL,
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 100),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, closed_on)
);

CREATE TABLE merchant.staff_memberships (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      text NOT NULL,
  merchant_id  bigint NOT NULL REFERENCES merchant.merchants(id),
  location_id  bigint REFERENCES merchant.locations(id),
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'picker')),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, merchant_id)
);
CREATE INDEX idx_staff_memberships_user ON merchant.staff_memberships(user_id) WHERE active;
CREATE TRIGGER trg_staff_memberships_updated_at BEFORE UPDATE ON merchant.staff_memberships
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE commerce.slots (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id  bigint NOT NULL REFERENCES merchant.locations(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 0),
  booked       integer NOT NULL DEFAULT 0 CHECK (booked >= 0),
  held         integer NOT NULL DEFAULT 0 CHECK (held >= 0),

  closed       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, starts_at),
  CHECK (ends_at > starts_at),
  CHECK (booked + held <= capacity)
);
CREATE INDEX idx_slots_location_time ON commerce.slots(location_id, starts_at);
CREATE TRIGGER trg_slots_updated_at BEFORE UPDATE ON commerce.slots
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE commerce.slot_holds (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id      bigint NOT NULL REFERENCES commerce.slots(id),
  order_id     bigint NOT NULL UNIQUE REFERENCES commerce.orders(id),
  status       text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'booked', 'released')),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_slot_holds_expiry ON commerce.slot_holds(expires_at) WHERE status = 'held';
CREATE TRIGGER trg_slot_holds_updated_at BEFORE UPDATE ON commerce.slot_holds
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

ALTER TABLE commerce.orders
  ADD COLUMN fulfilment_type        text NOT NULL DEFAULT 'pickup' CHECK (fulfilment_type IN ('pickup')),
  ADD COLUMN slot_id                bigint REFERENCES commerce.slots(id),
  ADD COLUMN pickup_starts_at       timestamptz,
  ADD COLUMN pickup_ends_at         timestamptz,

  ADD COLUMN pickup_code            char(6) CHECK (pickup_code ~ '^[0-9]{6}$'),
  ADD COLUMN pickup_code_failures   integer NOT NULL DEFAULT 0 CHECK (pickup_code_failures >= 0),
  ADD COLUMN pickup_locked_at       timestamptz,
  ADD COLUMN accepted_at            timestamptz,
  ADD COLUMN accepted_by            text,
  ADD COLUMN escalated_at           timestamptz,
  ADD COLUMN picker_id              text,
  ADD COLUMN pick_started_at        timestamptz,
  ADD COLUMN pick_completed_at      timestamptz,
  ADD COLUMN arrived_at             timestamptz,
  ADD COLUMN arrival_note           text CHECK (char_length(arrival_note) <= 140),
  ADD COLUMN collected_at           timestamptz,
  ADD COLUMN handed_over_by         text,

  ADD COLUMN rating                 smallint CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN rating_tags            text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(rating_tags) <= 6),
  ADD COLUMN rating_comment         text CHECK (char_length(rating_comment) <= 500),
  ADD COLUMN rated_at               timestamptz,
  ADD CONSTRAINT orders_pickup_window CHECK (
    (pickup_starts_at IS NULL) = (pickup_ends_at IS NULL)
    AND (pickup_ends_at IS NULL OR pickup_ends_at > pickup_starts_at));
CREATE INDEX idx_orders_location_queue ON commerce.orders(location_id, status, pickup_starts_at);

ALTER TABLE commerce.order_lines
  ADD COLUMN upc                      text,
  ADD COLUMN category                 text,

  ADD COLUMN label_price_cents        bigint CHECK (label_price_cents >= 0),
  ADD COLUMN scanned_code             text,
  ADD COLUMN unavailable_reason       text CHECK (unavailable_reason IN ('out_of_stock', 'damaged', 'quality', 'other')),
  ADD COLUMN substitution_reason      text CHECK (char_length(substitution_reason) <= 140),

  ADD COLUMN customer_decision        text CHECK (customer_decision IN ('pending', 'approved', 'rejected')),
  ADD COLUMN customer_decided_at      timestamptz,
  ADD COLUMN picked_by                text,
  ADD COLUMN picked_at                timestamptz,
  ADD CONSTRAINT order_lines_decision_only_on_substitutes CHECK (
    customer_decision IS NULL OR substitutes_line_id IS NOT NULL);
CREATE UNIQUE INDEX uq_order_lines_one_substitute ON commerce.order_lines(substitutes_line_id)
  WHERE substitutes_line_id IS NOT NULL;

CREATE TABLE ops.unrecognised_barcodes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id  bigint NOT NULL REFERENCES merchant.merchants(id),
  code         text NOT NULL CHECK (char_length(code) <= 64),
  order_id     bigint REFERENCES commerce.orders(id),
  scanned_by   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_unrecognised_barcodes_merchant ON ops.unrecognised_barcodes(merchant_id, at DESC);

CREATE TABLE catalog.category_availability (
  merchant_id   bigint NOT NULL REFERENCES merchant.merchants(id),
  category_id   bigint NOT NULL REFERENCES catalog.categories(id),
  hidden_until  timestamptz NOT NULL,
  updated_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, category_id)
);

CREATE OR REPLACE VIEW catalog.product_view AS
SELECT
  p.id, p.external_id, p.slug, p.merchant_id, p.location_id,
  m.slug AS merchant_slug, m.name AS merchant_name,
  COALESCE(o.name, p.name) AS name,
  p.name AS source_name,
  p.brand, p.upc, p.description, p.currency, p.sku, p.availability, p.images,
  COALESCE(o.subcategory_id, p.subcategory_id) AS subcategory_id,
  s.name AS subcategory, s.slug AS subcategory_slug,
  c.id AS category_id, c.name AS category, c.slug AS category_slug,
  p.pricing_model, p.unit, p.sell_by, p.unit_price_cents,
  COALESCE(o.estimated_weight_lb, p.estimated_weight_lb) AS estimated_weight_lb,
  p.weight_step_lb, p.min_weight_lb, p.tax_code, p.deposit_cents, p.min_qty, p.max_qty,
  p.available_days, p.organic, p.dietary_claims, p.attributes, p.nutrition_label, p.disclaimer,
  p.is_alcohol, p.pickup_only, p.source_type, p.source_subtype, p.source_virtual_category, p.source_status,
  COALESCE(o.blocked_reason, p.blocked_reason) AS blocked_reason,
  COALESCE(o.hidden, false) AS hidden,
  GREATEST(o.hidden_until, ca.hidden_until) AS hidden_until,
  p.deleted_at, p.created_at,
  GREATEST(p.updated_at, o.updated_at) AS updated_at,
  (p.deleted_at IS NULL
    AND p.source_status = 'listed'
    AND COALESCE(o.blocked_reason, p.blocked_reason) IS NULL
    AND NOT COALESCE(o.hidden, false)
    AND (o.hidden_until IS NULL OR o.hidden_until <= now())
    AND (ca.hidden_until IS NULL OR ca.hidden_until <= now())
    AND m.storefront_visible) AS is_visible
FROM catalog.products p
JOIN merchant.merchants m ON m.id = p.merchant_id
LEFT JOIN catalog.product_overrides o ON o.product_id = p.id
JOIN catalog.subcategories s ON s.id = COALESCE(o.subcategory_id, p.subcategory_id)
JOIN catalog.categories c ON c.id = s.category_id
LEFT JOIN catalog.category_availability ca ON ca.merchant_id = p.merchant_id AND ca.category_id = c.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- merchant schema default privileges already give SELECT/INSERT/UPDATE; closures and staff
    -- memberships can also be removed
    GRANT DELETE ON merchant.location_closures TO app_rw;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.category_availability TO app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest_rw') THEN
    GRANT SELECT ON catalog.category_availability TO ingest_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    GRANT SELECT ON catalog.category_availability TO readonly;
  END IF;
END;
$$;
