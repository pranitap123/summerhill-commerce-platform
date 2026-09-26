import { NextRequest, NextResponse } from 'next/server';
import catalogPool from '@/lib/catalogDb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await catalogPool.query(
      `SELECT p.id, p.name, p.description, p.price, p.currency,
              p.sku, p.availability, p.images,
              c.name AS category, s.name AS subcategory
       FROM products p
       JOIN subcategories s ON p.subcategory_id = s.id
       JOIN categories c ON s.category_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error(`GET /api/products/${id} failed:`, err);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}