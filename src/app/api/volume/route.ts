import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/volume?universe=sp500|nasdaq|both&basis=avg|prev&limit=30
 *
 * Confronto del volume dell'ultima seduta con:
 *  - basis=avg  : media delle 20 sedute precedenti (predefinito)
 *  - basis=prev : sola seduta precedente
 *
 * La media e' piu' informativa: un singolo giorno fiacco fa esplodere il
 * rapporto rispetto al giorno prima senza che sia successo nulla.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const universeParam = url.searchParams.get('universe') ?? 'both';
  const basis = url.searchParams.get('basis') === 'prev' ? 'prev' : 'avg';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 60);
  const lookback = 20;

  const t0 = Date.now();

  try {
    let tickers: string[];
    if (universeParam === 'sp500') {
      tickers = [...((MARKETS['S&P 500'] as readonly string[]) ?? [])];
    } else if (universeParam === 'nasdaq') {
      tickers = [...((MARKETS['NASDAQ'] as readonly string[]) ?? [])];
    } else {
      tickers = Array.from(
        new Set([
          ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
          ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
        ])
      );
    }

    const data = await yahooDownloadMany(tickers, '3mo', '1d', 10);

    type Row = {
      ticker: string;
      market: string | null;
      date: string;
      volume: number;
      avgVolume: number;
      prevVolume: number;
      /** Quante volte il volume medio */
      ratio: number;
      /** Variazione percentuale rispetto al riferimento scelto */
      changePct: number;
      close: number;
      priceChangePct: number;
      /** Controvalore scambiato, per valutare la liquidita' reale */
      turnover: number;
    };

    const rows: Row[] = [];
    let skipped = 0;
    let lastSessionDate = '';

    for (const ticker of tickers) {
      const c = data[ticker];
      if (!c || c.length < lookback + 2) {
        skipped++;
        continue;
      }
      const n = c.length - 1;
      const last = c[n];
      const prev = c[n - 1];
      if (!last.v || last.v <= 0 || !last.c || last.c <= 0) {
        skipped++;
        continue;
      }

      // Media delle sedute precedenti, esclusa quella in esame
      let sum = 0;
      let count = 0;
      for (let i = n - lookback; i < n; i++) {
        if (i < 0) continue;
        const v = c[i].v;
        if (v && v > 0) {
          sum += v;
          count++;
        }
      }
      if (count < Math.floor(lookback / 2)) {
        skipped++;
        continue;
      }
      const avgVolume = sum / count;
      if (avgVolume <= 0) {
        skipped++;
        continue;
      }

      const reference = basis === 'prev' ? prev.v || avgVolume : avgVolume;
      if (reference <= 0) {
        skipped++;
        continue;
      }

      const d = new Date(last.t * 1000).toISOString().slice(0, 10);
      if (d > lastSessionDate) lastSessionDate = d;

      rows.push({
        ticker,
        market: getMarketForTicker(ticker),
        date: d,
        volume: last.v,
        avgVolume,
        prevVolume: prev.v ?? 0,
        ratio: last.v / avgVolume,
        changePct: ((last.v - reference) / reference) * 100,
        close: last.c,
        priceChangePct: prev.c > 0 ? ((last.c - prev.c) / prev.c) * 100 : 0,
        turnover: last.v * last.c,
      });
    }

    // Escludo i titoli con controvalore irrisorio: su quelli un raddoppio
    // di volume non significa nulla
    const MIN_TURNOVER = 5_000_000;
    const liquid = rows.filter((r) => r.turnover >= MIN_TURNOVER);

    const top = [...liquid]
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, limit);

    return NextResponse.json({
      basis,
      lookback,
      lastSessionDate,
      results: top,
      stats: {
        requested: tickers.length,
        answered: rows.length,
        skipped,
        liquid: liquid.length,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore volumi: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
