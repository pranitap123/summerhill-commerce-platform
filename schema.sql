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