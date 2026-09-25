const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const API_KEY = process.env.API_KEY;
const LOCATION_ID = process.env.LOCATION_ID;
const PRICELIST_ID = process.env.PRICELIST_ID;
const BASE_URL = process.env.BASE_URL;
const CURRENCY = process.env.CURRENCY;
const IMAGE_BASE = process.env.IMAGE_BASE;

if(!API_KEY || !LOCATION_ID || !PRICELIST_ID) {
    console.log('Missing required env vars: API_KEY, LOCATION_ID, PRICELIST_ID');
    process.exit(1);

}

async function fetchProducts() {
    try {
      const response = await axios.get(`${BASE_URL}/product/list?listType=ui`, {
        headers: {
          'apikey': API_KEY,
          'location': LOCATION_ID,
          'pricelist': PRICELIST_ID,
          'origin': 'https://shop.summerhillmarket.com',
          'referer': 'https://shop.summerhillmarket.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      return response.data.products;
    } catch (err) {
      console.error('Fetch failed:', err.response?.status || err.code, err.message);
      process.exit(1);
    }
  }
  
  function transformProduct(p) {
    const imageKey = p.mainImage || p.name;
    return {
      id: p.name,
      name: p.displayName,
      description: '',
      price: p.price,
      currency: CURRENCY,
      sku: p.upc,
      images: [`${IMAGE_BASE}/${imageKey}.jpg`],
      category: p.type,
      subcategory: p.subType,
      availability: p.isInStock ? 'in_stock' : 'out_of_stock'
    };
  }
  
  async function main() {
    console.log('Fetching products from', BASE_URL);
    const products = await fetchProducts();
    console.log(`Fetched ${products.length} products`);
  
    const grouped = {};
    
    for (const p of products) {
      const cat = p.type;
      const subcat = p.subType;
      if (!grouped[cat]) grouped[cat] = {};
      if (!grouped[cat][subcat]) grouped[cat][subcat] = [];
      grouped[cat][subcat].push(transformProduct(p));
    }
  
    const output = [];
    for (const [cat, subcats] of Object.entries(grouped)) {
      for (const [subcat, prods] of Object.entries(subcats)) {
        output.push({ category: cat, subcategory: subcat, products: prods });
      }
    }
  
    fs.writeFileSync('scraped.json', JSON.stringify(output, null, 2));
    console.log(`✓ Wrote ${output.length} category groups to scraped.json`);
  }
  
  main();