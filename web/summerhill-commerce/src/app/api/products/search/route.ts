import { NextRequest, NextResponse } from 'next/server';
import esClient from '@/lib/esClient';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Missing query param "q"' }, { status: 400 });
  }

  try {
    const result = await esClient.search({
      index: 'products',
      query: {
        multi_match: {
          query: q,
          fields: ['name', 'description'],
        },
      },
    });

    const hits = result.hits.hits.map((hit: any) => ({
      id: hit._id,
      score: hit._score,
      ...hit._source,
    }));

    return NextResponse.json({ query: q, count: hits.length, results: hits });
  } catch (err) {
    console.error('GET /api/products/search failed:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}