import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, type MarketKey, getMarketForTicker } from '@/lib/tickers';
import { detectFormations, type Formation } from '@/lib/formations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/formations — scansione a scaglioni con ripresa. */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const markets: MarketKey[] = body.markets?.length
    ? body.markets
    : (['S&P 500', 'NASDAQ'] as MarketKey[]);
  const offset = Math.max(0, Number(body.offset ?? 0));

  const t0 = Date.now();

  try {
    const universe = Array.from(
      new Set(markets.flatMap((m) => (MARKETS[m] as readonly string[]) ?? []))
    );

    const found: Array<Formation & { market: string | null }> = [];
    let analyzed = 0;
    let i = offset;
    const CHUNK = 40;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '1y', '1d', 8);

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 80) continue;
        analyzed++;
        for (const f of detectFormations(ticker, candles)) {
          found.push({ ...f, market: getMarketForTicker(ticker) });
        }
      }
      i += CHUNK;
    }

    // Salvataggio: le figure restano in archivio fra una scansione e
    // l'altra, cosi' non si perdono quelle viste in precedenza e si sa
    // da quando sono sotto osservazione.
    let saveError: string | null = null;
    if (found.length > 0) {
      const admin = createAdminClient();
      const now = new Date().toISOString();
      const seen = new Map<string, Record<string, unknown>>();
      for (const f of found) {
        seen.set(`${f.ticker}|${f.kind}`, {
          ticker: f.ticker,
          kind: f.kind,
          state: f.state,
          neckline: f.neckline,
          price: f.price,
          distance_to_neckline_pct: f.distanceToNecklinePct,
          depth_pct: f.depthPct,
          target: f.target,
          bars_span: f.barsSpan,
          points: f.points,
          market: f.market,
          last_seen: now,
          first_state: f.state,
        });
      }
      const { error } = await admin
        .from('formations')
        .upsert(Array.from(seen.values()), {
          onConflict: 'ticker,kind',
          ignoreDuplicates: false,
        });
      if (error) saveError = error.message;
    }

    if (saveError) {
      const missing = /schema cache|does not exist/i.test(saveError);
      return NextResponse.json(
        {
          error: missing
            ? "La tabella 'formations' non esiste ancora: esegui la migration 013_formations.sql."
            : `Salvataggio fallito: ${saveError}`,
        },
        { status: 500 }
      );
    }

    const done = i >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : i,
      universeSize: universe.length,
      processedUpTo: Math.min(i, universe.length),
      analyzed,
      formations: found,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
