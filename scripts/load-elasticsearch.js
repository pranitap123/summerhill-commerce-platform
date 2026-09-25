const { Client } = require('pg');
const http = require('http');

const pgClient = new Client({
  host: 'localhost',
  user: 'postgres',
  password: 'password',
  database: 'summerhill',
  port: 5432
});

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 9200,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  try {
    await pgClient.connect();
    console.log('Connected to Postgres');

    const result = await pgClient.query(`
      SELECT p.id, p.name, p.description, p.price, p.currency, p.availability, c.name AS category
      FROM products p
      JOIN subcategories s ON p.subcategory_id = s.id
      JOIN categories c ON s.category_id = c.id
    `);

    console.log(`Fetched ${result.rows.length} products from Postgres`);

    let indexedCount = 0;
    for (const product of result.rows) {
      const encodedId = encodeURIComponent(product.id);
      const res = await makeRequest('PUT', `/products/_doc/${encodedId}`, {
        name: product.name,
        description: product.description,
        category: product.category,
        price: parseFloat(product.price),
        availability: product.availability
      });
      if (res.status === 200 || res.status === 201) {
        indexedCount++;
      } else {
        console.error(`Failed to index ${product.id}:`, res.body);
      }
    }

    console.log(`Indexed ${indexedCount} of ${result.rows.length} products in Elasticsearch`);

    await pgClient.end();
    console.log('Postgres connection closed');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();