import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import {
  testPatterns,
  mergeAcc,
  emptyAcc,
  HORIZONS,
  type Acc,
  type PatternKind,
  type PatternSample,
} from '@/lib/pattern-test';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = { markets?: MarketKey[]; offset?: number; years?: '2y' | '5y' };

const KINDS: PatternKind[] = ['IHS', 'DOUBLE_BOTTOM'];

/**
 * POST /api/pattern-test
 *
 * Restituisce somme grezze invece di medie, cosi' il client aggrega piu'
 * chiamate senza perdita di precisione.
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
  const years = body.years === '2y' ? '2y' : '5y';

  const t0 = Date.now();

  try {
    const universe = Array.from(
      new Set(markets.flatMap((m) => (MARKETS[m] as readonly string[]) ?? []))
    );

    const signal = {} as Record<PatternKind, Record<number, Acc>>;
    for (const k of KINDS) {
      signal[k] = {};
      for (const h of HORIZONS) signal[k][h] = emptyAcc();
    }
    const baseline: Record<number, Acc> = {};
    for (const h of HORIZONS) baseline[h] = emptyAcc();

    const events: Record<PatternKind, number> = { IHS: 0, DOUBLE_BOTTOM: 0 };
    const samples: PatternSample[] = [];

    let analyzed = 0;
    let skipped = 0;
    let i = offset;
    const CHUNK = 40;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, years, '1d', 8);

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 200) {
          skipped++;
          continue;
        }
        const r = testPatterns(ticker, candles);
        if (!r) {
          skipped++;
          continue;
        }
        analyzed++;
        for (const k of KINDS) {
          events[k] += r.events[k];
          for (const h of HORIZONS) {
            signal[k][h] = mergeAcc(signal[k][h], r.signal[k][h]);
          }
        }
        for (const h of HORIZONS) {
          baseline[h] = mergeAcc(baseline[h], r.baseline[h]);
        }
        for (const s of r.samples) {
          if (samples.length < 60) samples.push(s);
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
      analyzed,
      skipped,
      events,
      signal,
      baseline,
      samples,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
