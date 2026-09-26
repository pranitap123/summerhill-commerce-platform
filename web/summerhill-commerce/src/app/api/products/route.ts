import { NextRequest, NextResponse } from 'next/server';
import catalogPool from '@/lib/catalogDb';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category'); // e.g. "Snacks"
  const sort = searchParams.get('sort') === 'price_desc' ? 'DESC' : 'ASC';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  try {
    const result = await catalogPool.query(
      `SELECT p.id, p.name, p.description, p.price, p.currency,
              p.sku, p.availability, p.images,
              c.name AS category, s.name AS subcategory
       FROM products p
       JOIN subcategories s ON p.subcategory_id = s.id
       JOIN categories c ON s.category_id = c.id
       WHERE ($1::text IS NULL OR c.name = $1)
       ORDER BY p.price ${sort}
       LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    );

    return NextResponse.json({
      page,
      limit,
      count: result.rows.length,
      products: result.rows,
    });
  } catch (err) {
    console.error('GET /api/products failed:', err);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}