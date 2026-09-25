const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  host: 'localhost',
  user: 'postgres',
  password: 'password',
  database: 'summerhill',
  port: 5432
});

(async () => {
  try {
    await client.connect();
    console.log('Connected to Postgres');

    const data = JSON.parse(fs.readFileSync('../scraped.json', 'utf-8'));
    console.log(`Loaded scraped.json with ${data.length} category/subcategory groups`);

    for (const group of data) {
      const categoryResult = await client.query(
        `INSERT INTO categories (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [group.category]
      );
      const categoryId = categoryResult.rows[0].id;

      const subcategoryResult = await client.query(
        `INSERT INTO subcategories (name, category_id) VALUES ($1, $2)
         ON CONFLICT (name, category_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [group.subcategory, categoryId]
      );
      const subcategoryId = subcategoryResult.rows[0].id;

      for (const product of group.products) {
        await client.query(
          `INSERT INTO products (id, name, description, price, currency, sku, availability, subcategory_id, images)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [
            product.name,
            product.name,
            product.description || '',
            product.price,
            product.currency,
            product.sku || null,
            product.availability || 'in_stock',
            subcategoryId,
            product.images || []
          ]
        );
      }
    }

    const catCountResult = await client.query('SELECT COUNT(*) FROM categories');
    const subCountResult = await client.query('SELECT COUNT(*) FROM subcategories');
    const prodCountResult = await client.query('SELECT COUNT(*) FROM products');

    const categoryCount = catCountResult.rows[0].count;
    const subcategoryCount = subCountResult.rows[0].count;
    const productCount = prodCountResult.rows[0].count;

    console.log(`Inserted ${categoryCount} categories, ${subcategoryCount} subcategories, ${productCount} products`);

    await client.end();
    console.log('Connection closed');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();