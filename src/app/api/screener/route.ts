import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, type MarketKey, getMarketForTicker } from '@/lib/tickers';
import {
  rankSectors,
  screenTicker,
  perfOverBars,
  SECTOR_ETFS,
  TICKER_SECTOR,
  BENCHMARK,
  type ScreenerResult,
  type SectorStrength,
} from '@/lib/screener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  /** Se true, ritorna solo i titoli che passano il trend template */
  onlyTrendPass?: boolean;
  /** Se true, ritorna solo quelli in pullback */
  onlyPullback?: boolean;
  /** Massimo risultati (default 60) */
  limit?: number;
};

/**
 * POST /api/screener
 *
 * Serve 1 anno di dati per calcolare la MA200 e il range a 52 settimane,
 * quindi il download è più pesante di uno scan normale. Su Vercel Hobby
 * (60s) conviene selezionare 1-2 mercati per volta.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const markets = body.markets?.length ? body.markets : (['S&P 500'] as MarketKey[]);
  const limit = body.limit ?? 60;

  const t0 = Date.now();

  try {
    // ------------------------------------------------------------------
    // FASE 1 — Forza settoriale: scarico gli ETF settoriali + benchmark
    // ------------------------------------------------------------------
    const sectorTickers = [...Object.keys(SECTOR_ETFS), BENCHMARK];
    const sectorCandles = await yahooDownloadMany(sectorTickers, '1y', '1d', 6);
    const sectors: SectorStrength[] = rankSectors(sectorCandles);

    // Mappa etf → perf3m e rank, serve per il calcolo della forza relativa
    const sectorPerf3m = new Map<string, number | null>();
    const sectorRankMap = new Map<string, number>();
    for (const s of sectors) {
      sectorPerf3m.set(s.etf, s.perf3m);
      sectorRankMap.set(s.etf, s.rank);
    }

    // ------------------------------------------------------------------
    // FASE 2 — Universo titoli dai mercati selezionati
    // ------------------------------------------------------------------
    const universe = Array.from(
      new Set(markets.flatMap((m) => (MARKETS[m] as readonly string[]) ?? []))
    );

    // 1 anno di dati per MA200 + range 52 settimane
    const candlesByTicker = await yahooDownloadMany(universe, '1y', '1d', 8);

    // ------------------------------------------------------------------
    // FASE 3 — Screening titolo per titolo
    // ------------------------------------------------------------------
    const results: ScreenerResult[] = [];
    let skipped = 0;

    for (const [ticker, candles] of Object.entries(candlesByTicker)) {
      if (!candles || candles.length < 200) {
        skipped++;
        continue;
      }
      const etf = TICKER_SECTOR[ticker] ?? null;
      const r = screenTicker(ticker, candles, {
        market: getMarketForTicker(ticker),
        sectorEtf: etf,
        sectorName: etf ? SECTOR_ETFS[etf] : null,
        sectorPerf3m: etf ? (sectorPerf3m.get(etf) ?? null) : null,
        sectorRank: etf ? (sectorRankMap.get(etf) ?? null) : null,
      });
      if (r) results.push(r);
      else skipped++;
    }

    // ------------------------------------------------------------------
    // FASE 4 — Filtri e ordinamento
    // ------------------------------------------------------------------
    let filtered = results;
    if (body.onlyTrendPass) {
      filtered = filtered.filter((r) => r.trendTemplatePass);
    }
    if (body.onlyPullback) {
      filtered = filtered.filter((r) => r.inPullback && r.pullbackScore > 0);
    }

    filtered.sort((a, b) => b.totalScore - a.totalScore);
    const top = filtered.slice(0, limit);

    return NextResponse.json({
      sectors,
      results: top,
      stats: {
        universeSize: universe.length,
        analyzed: results.length,
        skipped,
        matching: filtered.length,
        returned: top.length,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore screener: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
