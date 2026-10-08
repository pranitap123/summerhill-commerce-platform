

CREATE TABLE catalog.categories (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE catalog.subcategories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  category_id  bigint NOT NULL REFERENCES catalog.categories(id),
  UNIQUE (name, category_id)
);

CREATE TABLE catalog.products (

  id              text PRIMARY KEY,
  merchant_id     bigint NOT NULL REFERENCES merchant.merchants(id),
  location_id     bigint NOT NULL REFERENCES merchant.locations(id),
  subcategory_id  bigint NOT NULL REFERENCES catalog.subcategories(id),
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  price           numeric(10, 2) NOT NULL CHECK (price >= 0),
  currency        char(3) NOT NULL DEFAULT 'CAD',
  sku             text,
  availability    text NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock', 'out_of_stock')),
  images          text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_subcategory_id ON catalog.products(subcategory_id);
CREATE INDEX idx_products_merchant_id    ON catalog.products(merchant_id);
CREATE INDEX idx_products_location_id    ON catalog.products(location_id);
CREATE INDEX idx_products_price          ON catalog.products(price);
CREATE INDEX idx_products_availability   ON catalog.products(availability);

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON catalog.products
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
