import { NextResponse } from 'next/server';
import { yahooSearch } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=apple
 * Cerca ticker a partire da nome o simbolo.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) return NextResponse.json({ results: [] });

  const results = await yahooSearch(q, 10);
  return NextResponse.json({ results });
}
