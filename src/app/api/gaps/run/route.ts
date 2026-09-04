import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { analyzeGaps, FILL_HORIZONS } from '@/lib/gaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function usUniverse(): string[] {
  return Array.from(
    new Set([
      ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
      ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
    ])
  );
}

/**
 * POST /api/gaps/run
 * body: { offset?: number, minGapPct?: number }
 *
 * Elaborazione a scaglioni con ripresa: ~400 titoli su 5 anni non stanno
 * nei 60s di Vercel in una sola chiamata.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body.offset ?? 0));
  const minGapPct = Number(body.minGapPct ?? 2);

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = usUniverse();
    let i = offset;
    const CHUNK = 40;
    let analyzed = 0;
    let gapsFound = 0;
    let openFound = 0;
    let dbError: string | null = null;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '5y', '1d', 8);

      const gapRows: Array<Record<string, unknown>> = [];
      const statRows: Array<Record<string, unknown>> = [];

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 60) continue;
        const r = analyzeGaps(ticker, candles, minGapPct);
        if (!r) continue;
        analyzed++;
        gapsFound += r.allGaps.length;
        openFound += r.openGaps.length;

        const market = getMarketForTicker(ticker);

        // Salvo solo i gap degli ultimi due anni: lo storico completo
        // serve alle statistiche, non alla consultazione
        const cutoff = new Date(Date.now() - 730 * 86400000)
          .toISOString()
          .slice(0, 10);
        for (const g of r.allGaps) {
          if (g.date < cutoff) continue;
          gapRows.push({
            ticker: g.ticker,
            gap_date: g.date,
            direction: g.direction,
            gap_pct: g.gapPct,
            open_price: g.openPrice,
            target_price: g.targetPrice,
            edge_price: g.edgePrice,
            filled: g.filled,
            fill_date: g.fillDate,
            days_to_fill: g.daysToFill,
            days_open: g.daysOpen,
            market,
            updated_at: new Date().toISOString(),
          });
        }

        const s = r.stats;
        statRows.push({
          ticker,
          total_gaps: s.totalGaps,
          open_gaps: s.openGaps,
          filled_5d: s.filledWithin[5].filled,
          eligible_5d: s.filledWithin[5].eligible,
          filled_20d: s.filledWithin[20].filled,
          eligible_20d: s.filledWithin[20].eligible,
          filled_60d: s.filledWithin[60].filled,
          eligible_60d: s.filledWithin[60].eligible,
          median_days_to_fill: s.medianDaysToFill,
          updated_at: new Date().toISOString(),
        });
      }

      if (gapRows.length > 0) {
        const seen = new Map<string, (typeof gapRows)[0]>();
        for (const g of gapRows) seen.set(`${g.ticker}|${g.gap_date}`, g);
        const { error } = await admin
          .from('price_gaps')
          .upsert(Array.from(seen.values()), {
            onConflict: 'ticker,gap_date',
            ignoreDuplicates: false,
          });
        if (error && !dbError) dbError = error.message;
      }
      if (statRows.length > 0) {
        const { error } = await admin
          .from('gap_stats')
          .upsert(statRows, { onConflict: 'ticker', ignoreDuplicates: false });
        if (error && !dbError) dbError = error.message;
      }

      i += CHUNK;
    }

    if (dbError) {
      const missing = /schema cache|does not exist/i.test(dbError);
      return NextResponse.json(
        {
          error: missing
            ? "Le tabelle dei gap non esistono ancora: esegui la migration 010_price_gaps.sql nell'SQL Editor di Supabase."
            : `Salvataggio fallito: ${dbError}`,
        },
        { status: 500 }
      );
    }

    const done = i >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : i,
      stats: {
        universeSize: universe.length,
        processedUpTo: Math.min(i, universe.length),
        analyzed,
        gapsFound,
        openFound,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
