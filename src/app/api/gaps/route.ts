import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { VOLUME_BUCKETS, bucketOf } from '@/lib/gaps';

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

  // Momento dell'ultima scansione: senza, un archivio vecchio sembra fresco
  const { data: lastRow } = await supabase
    .from('price_gaps')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ------------------------------------------------------------------
  // Confronto dei tassi di chiusura per fascia di volume.
  //
  // La domanda: i gap su volume elevato si richiudono davvero meno di
  // quelli ordinari? Il calcolo va fatto sull'intero archivio, non sui
  // soli gap in elenco, altrimenti il filtro attivo distorcerebbe il
  // risultato.
  //
  // Un gap conta per l'orizzonte h solo se ha avuto almeno h sedute a
  // disposizione: o si e' chiuso, oppure risulta aperto da almeno h
  // sedute. Senza questa condizione i gap recenti abbasserebbero il
  // tasso per il solo fatto di essere recenti.
  // ------------------------------------------------------------------
  const { data: allGaps } = await supabase
    .from('price_gaps')
    .select('volume_ratio, days_to_fill, days_open, filled')
    .not('volume_ratio', 'is', null)
    .limit(20000);

  const HORIZONS = [5, 20, 60];
  const buckets: Record<
    string,
    { label: string; total: number; horizons: Record<number, { filled: number; eligible: number }> }
  > = {};
  for (const b of VOLUME_BUCKETS) {
    buckets[b.key] = {
      label: b.label,
      total: 0,
      horizons: Object.fromEntries(
        HORIZONS.map((h) => [h, { filled: 0, eligible: 0 }])
      ),
    };
  }

  for (const g of allGaps ?? []) {
    const key = bucketOf(g.volume_ratio == null ? null : Number(g.volume_ratio));
    if (!key || !buckets[key]) continue;
    buckets[key].total += 1;
    const dtf = g.days_to_fill == null ? null : Number(g.days_to_fill);
    const dop = g.days_open == null ? null : Number(g.days_open);
    for (const h of HORIZONS) {
      // Un gap gia' chiuso ha per definizione avuto il tempo necessario
      // per esserlo; uno ancora aperto conta solo se lo e' da almeno h
      // sedute, altrimenti non ha ancora avuto occasione di chiudersi.
      const eligible = dtf != null ? true : dop != null && dop >= h;
      if (!eligible) continue;
      buckets[key].horizons[h].eligible += 1;
      if (dtf != null && dtf <= h) buckets[key].horizons[h].filled += 1;
    }
  }

  return NextResponse.json({
    gaps: gaps ?? [],
    stats,
    totalOpen: count ?? 0,
    volumeBuckets: buckets,
    volumeAnalysisSize: (allGaps ?? []).length,
    lastScan: lastRow?.updated_at ?? null,
  });
}
