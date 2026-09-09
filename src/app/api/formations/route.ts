import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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
