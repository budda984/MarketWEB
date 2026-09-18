import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/replay/gaps?min=6&direction=up|down|all&days=59
 *
 * Sedute aperte con un gap almeno pari a min%, prese dall'archivio dei
 * gap (tabella price_gaps). days limita la ricerca al periodo coperto
 * dalla risoluzione scelta nel replay: con l'1 minuto Yahoo non va oltre
 * i 30 giorni, quindi proporre gap piu' vecchi sarebbe inutile.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const min = Math.max(0.5, Number(url.searchParams.get('min') ?? 6) || 6);
  const direction = url.searchParams.get('direction') ?? 'up';
  const days = Math.min(3650, Math.max(1, Number(url.searchParams.get('days') ?? 59) || 59));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  let q = supabase
    .from('price_gaps')
    .select('ticker, gap_date, direction, gap_pct, volume_ratio, filled')
    .gte('gap_date', since)
    .order('gap_date', { ascending: false })
    .limit(300);

  if (direction === 'up') q = q.gte('gap_pct', min);
  else if (direction === 'down') q = q.lte('gap_pct', -min);
  else q = q.or(`gap_pct.gte.${min},gap_pct.lte.${-min}`);

  const { data, error } = await q;
  if (error) {
    const missing = /schema cache|does not exist/i.test(error.message);
    return NextResponse.json(
      {
        error: missing
          ? 'Archivio gap assente: esegui la migration 010_price_gaps.sql e lancia una scansione dalla sezione Gap.'
          : error.message,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ gaps: data ?? [], since });
}
