-- Catalogue v2 (G3): the full canonical product model (CATALOG §3), taxonomy mapping (§7),
-- overrides that survive re-ingest (§3.2), ingest runs with quarantine (§4), slug history for
-- 301 redirects and search analytics (§8.4). Products are written only by the /pipeline package
-- (role ingest_rw); the web app reads them through catalog.product_view.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- taxonomy ------------------------------------------------------------------------------
ALTER TABLE catalog.categories
  ADD COLUMN slug text UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 100;
ALTER TABLE catalog.subcategories
  ADD COLUMN slug text CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 100,
  ADD CONSTRAINT subcategories_category_slug_key UNIQUE (category_id, slug);

-- Per-merchant mapping of the source's type/subtype to our subcategory (CATALOG §7). An empty
-- source_subtype is the fallback for the whole type. Rows with subcategory_id NULL are unknown
-- source categories the pipeline found: their products go to "Uncategorised" until an admin maps them.
CREATE TABLE catalog.category_mappings (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id     bigint NOT NULL REFERENCES merchant.merchants(id),
  source_type     text NOT NULL,
  source_subtype  text NOT NULL DEFAULT '',
  subcategory_id  bigint REFERENCES catalog.subcategories(id),
  status          text NOT NULL DEFAULT 'mapped' CHECK (status IN ('mapped', 'unmapped')),
  first_seen_run  bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, source_type, source_subtype),
  CHECK ((status = 'mapped') = (subcategory_id IS NOT NULL))
);
CREATE TRIGGER trg_category_mappings_updated_at BEFORE UPDATE ON catalog.category_mappings
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- ---- canonical product model ----------------------------------------------------------------
ALTER TABLE catalog.products
  -- The source's stable identifier. products.id = connector id prefix + external_id.
  ADD COLUMN external_id text,
  ADD COLUMN slug text UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN brand text,
  ADD COLUMN upc text,
  ADD COLUMN source_type text,
  ADD COLUMN source_subtype text,
  ADD COLUMN source_virtual_category text,
  ADD COLUMN organic boolean NOT NULL DEFAULT false,
  -- As supplied by the merchant; shown with a "check the label" disclaimer (CATALOG §3)
  ADD COLUMN dietary_claims text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN nutrition_label text,
  ADD COLUMN disclaimer text,
  ADD COLUMN is_alcohol boolean NOT NULL DEFAULT false,
  ADD COLUMN pickup_only boolean NOT NULL DEFAULT false,
  -- Set by ingest (e.g. alcohol_not_licensed); an override can also block a product
  ADD COLUMN blocked_reason text,
  ADD COLUMN source_status text NOT NULL DEFAULT 'listed' CHECK (source_status IN ('listed', 'unlisted')),
  -- Change detection: hash of the normalised payload; equal hash = no write
  ADD COLUMN source_hash text,
  ADD COLUMN last_ingest_run_id bigint,
  -- Soft delete: a full run that no longer sees the product sets this; it's never hard-deleted
  -- (carts and orders reference it)
  ADD COLUMN deleted_at timestamptz;

UPDATE catalog.products SET external_id = id WHERE external_id IS NULL;
ALTER TABLE catalog.products
  ALTER COLUMN external_id SET NOT NULL,
  ADD CONSTRAINT products_merchant_external_id_key UNIQUE (merchant_id, external_id);

CREATE INDEX idx_products_upc ON catalog.products(merchant_id, upc) WHERE upc IS NOT NULL;
CREATE INDEX idx_products_live ON catalog.products(subcategory_id) WHERE deleted_at IS NULL;
-- Postgres search fallback (ADR-0007): trigram similarity for typos and prefixes
CREATE INDEX idx_products_name_trgm ON catalog.products USING gin (lower(name) gin_trgm_ops);
CREATE INDEX idx_products_brand_trgm ON catalog.products USING gin (lower(coalesce(brand, '')) gin_trgm_ops);

ALTER TABLE catalog.promotions
  DROP CONSTRAINT promotions_kind_check,
  ADD CONSTRAINT promotions_kind_check CHECK (kind IN ('price_override', 'percent_off')),
  ADD COLUMN source_hash text;

-- Old slugs → product, for 301 redirects after a rename (CATALOG §3, G3-13)
CREATE TABLE catalog.product_slug_history (
  slug        text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES catalog.products(id),
  retired_at  timestamptz NOT NULL DEFAULT now()
);

-- Merchant or admin edits that survive re-ingest (CATALOG §3.2). Ingest never writes this table.
CREATE TABLE catalog.product_overrides (
  product_id           text PRIMARY KEY REFERENCES catalog.products(id),
  hidden               boolean NOT NULL DEFAULT false,
  -- "Out of stock today": hidden until this time (CATALOG §5)
  hidden_until         timestamptz,
  name                 text CHECK (name IS NULL OR length(trim(name)) > 0),
  subcategory_id       bigint REFERENCES catalog.subcategories(id),
  estimated_weight_lb  numeric(8, 3) CHECK (estimated_weight_lb > 0),
  blocked_reason       text,
  updated_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_product_overrides_updated_at BEFORE UPDATE ON catalog.product_overrides
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- Merchants can be kept off the storefront (e.g. while onboarding) without touching the catalogue
ALTER TABLE merchant.merchants ADD COLUMN storefront_visible boolean NOT NULL DEFAULT true;

-- ---- read path ------------------------------------------------------------------------------
-- The only way the app reads products: overrides applied with COALESCE, visibility derived.
-- `hidden_until` is time-dependent, so is_visible is computed at query time, never stored.
CREATE VIEW catalog.product_view AS
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
  o.hidden_until,
  p.deleted_at, p.created_at,
  GREATEST(p.updated_at, o.updated_at) AS updated_at,
  (p.deleted_at IS NULL
    AND p.source_status = 'listed'
    AND COALESCE(o.blocked_reason, p.blocked_reason) IS NULL
    AND NOT COALESCE(o.hidden, false)
    AND (o.hidden_until IS NULL OR o.hidden_until <= now())
    AND m.storefront_visible) AS is_visible
FROM catalog.products p
JOIN merchant.merchants m ON m.id = p.merchant_id
LEFT JOIN catalog.product_overrides o ON o.product_id = p.id
JOIN catalog.subcategories s ON s.id = COALESCE(o.subcategory_id, p.subcategory_id)
JOIN catalog.categories c ON c.id = s.category_id;

-- ---- ingest runs and quarantine (CATALOG §4) -------------------------------------------------
CREATE TABLE ops.ingest_runs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id      bigint NOT NULL REFERENCES merchant.merchants(id),
  connector        text NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('full', 'delta')),
  status           text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'applied', 'held', 'approved', 'rejected', 'failed')),
  fetched          integer NOT NULL DEFAULT 0,
  inserted         integer NOT NULL DEFAULT 0,
  updated          integer NOT NULL DEFAULT 0,
  unchanged        integer NOT NULL DEFAULT 0,
  deactivated      integer NOT NULL DEFAULT 0,
  quarantined      integer NOT NULL DEFAULT 0,
  -- Anomaly guard results: which checks tripped and the numbers behind them
  anomalies        jsonb NOT NULL DEFAULT '[]',
  -- Rule flags that don't block (price jumps, unmapped categories, missing images)
  flags            jsonb NOT NULL DEFAULT '[]',
  -- Normalised feed of a held run, applied as-is on approval
  staged           jsonb,
  error            text,
  approved_by      text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  duration_ms      integer
);
CREATE INDEX idx_ingest_runs_merchant ON ops.ingest_runs(merchant_id, id DESC);

CREATE TABLE ops.ingest_quarantine (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       bigint NOT NULL REFERENCES ops.ingest_runs(id) ON DELETE CASCADE,
  external_id  text,
  reason       text NOT NULL,
  raw          jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingest_quarantine_run ON ops.ingest_quarantine(run_id);

-- ---- search analytics (CATALOG §8.4): no PII, no user or session ids --------------------------
CREATE TABLE ops.search_queries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query         text NOT NULL CHECK (length(query) <= 100),
  result_count  integer NOT NULL CHECK (result_count >= 0),
  engine        text NOT NULL CHECK (engine IN ('elasticsearch', 'postgres')),
  filters       jsonb NOT NULL DEFAULT '{}',
  took_ms       integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_queries_created ON ops.search_queries(created_at);

CREATE TABLE ops.search_clicks (
  search_id   uuid NOT NULL REFERENCES ops.search_queries(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  position    integer NOT NULL CHECK (position >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, product_id)
);

-- ---- grants ---------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- The catalog schema is read-only for the app except for merchant/admin overrides
    GRANT SELECT ON catalog.product_view TO app_rw;
    GRANT INSERT, UPDATE, DELETE ON catalog.product_overrides TO app_rw;
    GRANT UPDATE (subcategory_id, status) ON catalog.category_mappings TO app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest_rw') THEN
    -- The pipeline records its runs and announces changes through the outbox (ADR-0008)
    GRANT SELECT, INSERT, UPDATE ON ops.ingest_runs TO ingest_rw;
    GRANT SELECT, INSERT ON ops.ingest_quarantine TO ingest_rw;
    GRANT INSERT ON ops.outbox TO ingest_rw;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO ingest_rw;
    GRANT SELECT ON catalog.product_view TO ingest_rw;
    -- Overrides are the app's: ingest may read them (for reports) but never write them
    REVOKE INSERT, UPDATE, DELETE ON catalog.product_overrides FROM ingest_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    GRANT SELECT ON catalog.product_view TO readonly;
  END IF;
END;
$$;
