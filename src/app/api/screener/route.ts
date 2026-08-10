import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany, type OHLCV } from '@/lib/yahoo';
import { MARKETS, type MarketKey, getMarketForTicker } from '@/lib/tickers';
import {
  rankSectors,
  screenTicker,
  SECTOR_ETFS,
  TICKER_SECTOR,
  BENCHMARK,
  type ScreenerResult,
  type SectorStrength,
} from '@/lib/screener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SortMode = 'value' | 'score' | 'momentum';

type Body = {
  markets?: MarketKey[];
  /** Quanti settori in testa considerare (default 3). 0 = tutti */
  topSectors?: number;
  onlyTrendPass?: boolean;
  onlyPullback?: boolean;
  sortBy?: SortMode;
  limit?: number;
};

/** Scarica a blocchi con pausa, per non farsi rate-limitare da Yahoo. */
async function downloadChunked(
  tickers: string[],
  chunkSize = 40,
  concurrency = 5,
  pauseMs = 150
): Promise<Record<string, OHLCV[]>> {
  const out: Record<string, OHLCV[]> = {};
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    const res = await yahooDownloadMany(chunk, '1y', '1d', concurrency);
    Object.assign(out, res);
    if (i + chunkSize < tickers.length) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  return out;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const topSectors = body.topSectors ?? 3;
  const sortBy: SortMode = body.sortBy ?? 'value';
  const limit = body.limit ?? 60;

  const t0 = Date.now();

  try {
    // ------------------------------------------------------------------
    // FASE 1 - Forza settoriale (12 richieste, veloce)
    // ------------------------------------------------------------------
    const sectorTickers = [...Object.keys(SECTOR_ETFS), BENCHMARK];
    const sectorCandles = await yahooDownloadMany(sectorTickers, '1y', '1d', 6);
    const sectors: SectorStrength[] = rankSectors(sectorCandles);

    if (sectors.length === 0) {
      return NextResponse.json(
        {
          error:
            'Impossibile scaricare i dati dei settori. Yahoo potrebbe aver limitato le richieste: riprova tra un minuto.',
        },
        { status: 503 }
      );
    }

    const sectorPerf3m = new Map<string, number | null>();
    const sectorRankMap = new Map<string, number>();
    for (const s of sectors) {
      sectorPerf3m.set(s.etf, s.perf3m);
      sectorRankMap.set(s.etf, s.rank);
    }

    // ------------------------------------------------------------------
    // FASE 2 - Universo: SOLO i titoli dei settori in testa.
    // Invece di scaricare 300 ticker (che fa scattare il rate limit di
    // Yahoo) ne scarichiamo ~60-120: quelli che stanno dove sta
    // ruotando il denaro.
    // ------------------------------------------------------------------
    const allowedSectors = new Set(
      topSectors > 0
        ? sectors.slice(0, topSectors).map((s) => s.etf)
        : sectors.map((s) => s.etf)
    );

    const marketUniverse = body.markets?.length
      ? new Set(
          body.markets.flatMap((m) => (MARKETS[m] as readonly string[]) ?? [])
        )
      : null;

    const universe = Object.entries(TICKER_SECTOR)
      .filter(([ticker, etf]) => {
        if (!allowedSectors.has(etf)) return false;
        if (marketUniverse && !marketUniverse.has(ticker)) return false;
        return true;
      })
      .map(([ticker]) => ticker);

    const topSectorNames = sectors
      .slice(0, topSectors > 0 ? topSectors : sectors.length)
      .map((s) => s.name);

    if (universe.length === 0) {
      return NextResponse.json({
        sectors,
        results: [],
        stats: {
          universeSize: 0,
          downloaded: 0,
          emptyDownloads: 0,
          tooShort: 0,
          analyzed: 0,
          matching: 0,
          returned: 0,
          elapsedMs: Date.now() - t0,
          topSectorNames,
        },
        warning:
          'Nessun titolo mappato nei settori in testa. La mappa settoriale copre i principali titoli USA: seleziona S&P 500 o NASDAQ, oppure aumenta il numero di settori.',
      });
    }

    // ------------------------------------------------------------------
    // FASE 3 - Download a blocchi
    // ------------------------------------------------------------------
    const candlesByTicker = await downloadChunked(universe);

    let emptyDownloads = 0;
    let tooShort = 0;

    // ------------------------------------------------------------------
    // FASE 4 - Screening
    // ------------------------------------------------------------------
    const results: ScreenerResult[] = [];
    for (const ticker of universe) {
      const candles = candlesByTicker[ticker];
      if (!candles || candles.length === 0) {
        emptyDownloads++;
        continue;
      }
      if (candles.length < 200) {
        tooShort++;
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
      else tooShort++;
    }

    // ------------------------------------------------------------------
    // FASE 5 - Filtri e ordinamento
    // ------------------------------------------------------------------
    let filtered = results;
    if (body.onlyTrendPass) {
      filtered = filtered.filter((r) => r.trendTemplatePass);
    }
    if (body.onlyPullback) {
      filtered = filtered.filter((r) => r.inPullback);
    }

    const sorters: Record<
      SortMode,
      (a: ScreenerResult, b: ScreenerResult) => number
    > = {
      value: (a, b) => b.valueInTrendScore - a.valueInTrendScore,
      score: (a, b) => b.totalScore - a.totalScore,
      momentum: (a, b) => b.momentumScore - a.momentumScore,
    };
    filtered.sort(sorters[sortBy]);

    const top = filtered.slice(0, limit);

    let warning: string | undefined;
    const emptyRatio = emptyDownloads / universe.length;
    if (emptyRatio > 0.5) {
      warning = `Yahoo ha rifiutato ${emptyDownloads} download su ${universe.length}: risultati parziali. Riprova tra un minuto.`;
    } else if (results.length > 0 && filtered.length === 0) {
      warning =
        'Nessun titolo supera i filtri attivi. Prova a togliere "solo in pullback" o "solo trend template superato".';
    }

    return NextResponse.json({
      sectors,
      results: top,
      stats: {
        universeSize: universe.length,
        downloaded: universe.length - emptyDownloads,
        emptyDownloads,
        tooShort,
        analyzed: results.length,
        matching: filtered.length,
        returned: top.length,
        elapsedMs: Date.now() - t0,
        topSectorNames,
      },
      warning,
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
