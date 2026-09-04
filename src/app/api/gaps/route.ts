import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/gaps?state=open|filled&direction=all|up|down&ticker=AAPL
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? 'open';
  const direction = url.searchParams.get('direction') ?? 'all';
  const ticker = url.searchParams.get('ticker')?.toUpperCase();

  let q = supabase
    .from('price_gaps')
    .select('*')
    .order('gap_date', { ascending: false })
    .limit(300);

  if (state === 'open') q = q.eq('filled', false);
  else if (state === 'filled') q = q.eq('filled', true);
  if (direction !== 'all') q = q.eq('direction', direction);
  if (ticker) q = q.eq('ticker', ticker);

  const { data: gaps, error } = await q;
  if (error) {
    const missing = /schema cache|does not exist/i.test(error.message);
    return NextResponse.json(
      {
        error: missing
          ? "Le tabelle dei gap non esistono ancora: esegui la migration 010_price_gaps.sql nell'SQL Editor di Supabase."
          : error.message,
      },
      { status: 500 }
    );
  }

  // Statistiche dei soli titoli presenti in elenco
  const tickers = Array.from(new Set((gaps ?? []).map((g) => g.ticker)));
  let stats: Record<string, unknown>[] = [];
  if (tickers.length > 0) {
    const { data } = await supabase
      .from('gap_stats')
      .select('*')
      .in('ticker', tickers.slice(0, 200));
    stats = data ?? [];
  }

  const { count } = await supabase
    .from('price_gaps')
    .select('*', { count: 'exact', head: true })
    .eq('filled', false);

  return NextResponse.json({ gaps: gaps ?? [], stats, totalOpen: count ?? 0 });
}
