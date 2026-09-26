import { NextResponse } from 'next/server';
import catalogPool from '@/lib/catalogDb';

export async function GET() {
  try {
    const result = await catalogPool.query(
      `SELECT id, name FROM categories ORDER BY name`
    );
    return NextResponse.json({ categories: result.rows });
  } catch (err) {
    console.error('GET /api/categories failed:', err);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}