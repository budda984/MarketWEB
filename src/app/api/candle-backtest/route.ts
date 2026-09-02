import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS } from '@/lib/tickers';
import {
  backtestEngulfing,
  mergeAcc,
  emptyAcc,
  HORIZONS,
  type HorizonAcc,
  type EngulfingOptions,
} from '@/lib/candlesticks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  offset?: number;
  years?: '2y' | '5y';
  options?: Partial<EngulfingOptions>;
};

/**
 * POST /api/candle-backtest
 *
 * Verifica l'engulfing ribassista su S&P 500 e NASDAQ. Restituisce
 * somme grezze anziche' medie, cosi' che il client possa aggregare piu'
 * chiamate senza perdita di precisione: con ~400 titoli su 5 anni non si
 * sta nei 60s di Vercel in una volta sola.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const offset = Math.max(0, Number(body.offset ?? 0));
  const years = body.years === '2y' ? '2y' : '5y';
  const t0 = Date.now();

  try {
    const universe = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ])
    );

    const signal: Record<number, HorizonAcc> = {};
    const baseline: Record<number, HorizonAcc> = {};
    for (const h of HORIZONS) {
      signal[h] = emptyAcc();
      baseline[h] = emptyAcc();
    }

    let tickersDone = 0;
    let tickersSkipped = 0;
    let totalEvents = 0;
    let i = offset;
    const CHUNK = 40;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, years, '1d', 8);

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 80) {
          tickersSkipped++;
          continue;
        }
        const r = backtestEngulfing(ticker, candles, body.options ?? {});
        if (!r) {
          tickersSkipped++;
          continue;
        }
        tickersDone++;
        totalEvents += r.events;
        for (const h of HORIZONS) {
          signal[h] = mergeAcc(signal[h], r.signal[h]);
          baseline[h] = mergeAcc(baseline[h], r.baseline[h]);
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
      tickersDone,
      tickersSkipped,
      totalEvents,
      signal,
      baseline,
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
