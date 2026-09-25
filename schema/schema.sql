CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE subcategories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    UNIQUE (name, category_id)
);

INSERT INTO categories (name) VALUES ('Snacks');
INSERT INTO subcategories (name, category_id) VALUES ('Chips', 1);
INSERT INTO subcategories (name, category_id) VALUES ('Chips', 999);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  sku TEXT,
  availability TEXT DEFAULT 'in_stock',
  subcategory_id INTEGER NOT NULL REFERENCES subcategories(id),
  images TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_subcategory_id ON products(subcategory_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_availability ON products(availability);