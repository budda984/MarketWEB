import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany, type Period } from '@/lib/yahoo';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import {
  backtestWeeklyHma,
  accumulate,
  emptyAccumulator,
  type BacktestAccumulator,
  type TickerBacktest,
} from '@/lib/weekly-backtest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  offset?: number;
  period?: Period;
  hmaPeriod?: number;
};

/**
 * POST /api/weekly-backtest
 *
 * Restituisce somme grezze invece di medie, cosi' il client puo'
 * aggregare piu' chiamate senza perdita di precisione: con molti titoli
 * non si sta nei 60s di Vercel in una volta sola.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const markets = body.markets?.length
    ? body.markets
    : (['S&P 500'] as MarketKey[]);
  const offset = Math.max(0, Number(body.offset ?? 0));
  const period: Period = body.period === 'max' ? 'max' : '5y';
  const hmaPeriod = Math.min(Math.max(Number(body.hmaPeriod ?? 50), 10), 100);

  const t0 = Date.now();

  try {
    const universe = Array.from(
      new Set(markets.flatMap((m) => (MARKETS[m] as readonly string[]) ?? []))
    );

    let acc: BacktestAccumulator = emptyAccumulator();
    let skipped = 0;
    // Esempi di operazioni recenti, per rendere leggibile il risultato
    const sampleTrades: Array<{ ticker: string } & TickerBacktest['trades'][0]> =
      [];

    let i = offset;
    const CHUNK = 40;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, period, '1wk', 8);

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < hmaPeriod + 20) {
          skipped++;
          continue;
        }
        const r = backtestWeeklyHma(ticker, candles, hmaPeriod);
        if (!r) {
          skipped++;
          continue;
        }
        acc = accumulate(acc, r);

        if (sampleTrades.length < 40) {
          for (const t of r.trades.slice(-2)) {
            if (sampleTrades.length < 40) sampleTrades.push({ ticker, ...t });
          }
        }
      }

      i += CHUNK;
    }

    const done = i >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : i,
      universeSize: universe.length,
      processedUpTo: Math.min(i, universe.length),
      skipped,
      accumulator: acc,
      sampleTrades,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore backtest: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
