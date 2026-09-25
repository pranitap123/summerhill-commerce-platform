const http = require('http');

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 9200,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
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
    const mapping = {
      mappings: {
        properties: {
          name: { type: 'text' },
          description: { type: 'text' },
          category: { type: 'keyword' },
          price: { type: 'float' },
          availability: { type: 'keyword' }
        }
      }
    };

    const result = await makeRequest('PUT', '/products', mapping);
    console.log('Index created:', result.body);
  } catch (error) {
    console.error('Error:', error.message);
  }
})();