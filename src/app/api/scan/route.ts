import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import { scanTickers, type SignalStrength } from '@/lib/signals';
import { MARKETS, type MarketKey, ALL_TICKERS } from '@/lib/tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  tickers?: string[];
  minStrength?: SignalStrength;
  persist?: boolean;
};

/**
 * POST /api/scan
 * Scansione manuale. Se persist=true, salva i segnali nel DB.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const minStrength = (body.minStrength ?? 1) as SignalStrength;
  const persist = body.persist ?? false;

  // Costruisci l'universo di ticker
  let universe: string[];
  if (body.tickers && body.tickers.length > 0) {
    universe = body.tickers;
  } else if (body.markets && body.markets.length > 0) {
    universe = Array.from(
      new Set(body.markets.flatMap((m) => MARKETS[m] ?? []))
    );
  } else {
    universe = ALL_TICKERS;
  }

  const t0 = Date.now();
  const candlesByTicker = await yahooDownloadMany(universe, '3mo', '1d', 12);
  const signals = await scanTickers(candlesByTicker, minStrength);
  const elapsed = Date.now() - t0;

  if (persist && signals.length > 0) {
    const rows = signals.map((s) => ({
      user_id: user.id,
      ticker: s.ticker,
      strategy: 'HMA50_HA',
      strength: s.strength,
      price: s.price,
      hma_value: s.hmaValue,
      distance_pct: s.distancePct,
      crossed_bars_ago: s.crossedBarsAgo,
      change_pct: s.changePct,
      ha_bullish: s.haBullish,
      details: s.details,
      signal_at: new Date(s.timestamp * 1000).toISOString(),
      status: 'ACTIVE' as const,
      entry_price: s.price,
    }));
    await supabase.from('signals').insert(rows);
  }

  return NextResponse.json({
    count: signals.length,
    scanned: universe.length,
    elapsedMs: elapsed,
    signals,
  });
}
