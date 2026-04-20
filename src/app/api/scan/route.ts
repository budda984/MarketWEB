import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany, type OHLCV } from '@/lib/yahoo';
import { scanTickers, type SignalStrength } from '@/lib/signals';
import { detectHeadAndShoulders, type HSPattern } from '@/lib/patterns';
import { MARKETS, type MarketKey, ALL_TICKERS } from '@/lib/tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  tickers?: string[];
  minStrength?: SignalStrength;
  persist?: boolean;
  includePatterns?: boolean; // default true
};

type ScanCombined = {
  hmaSignals: number;
  patternSignals: number;
};

/**
 * POST /api/scan
 * Scansione manuale. Valuta HMA+HA e, se includePatterns=true, anche H&S/IHS.
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
  const includePatterns = body.includePatterns ?? true;

  // Universo
  let universe: string[];
  if (body.tickers && body.tickers.length > 0) {
    universe = body.tickers;
  } else if (body.markets && body.markets.length > 0) {
    universe = Array.from(
      new Set(body.markets.flatMap((m) => MARKETS[m] ?? []))
    );
  } else {
    universe = [...ALL_TICKERS];
  }

  const t0 = Date.now();
  const candlesByTicker = await yahooDownloadMany(universe, '3mo', '1d', 12);
  const hmaSignals = await scanTickers(candlesByTicker, minStrength);

  // Pattern detection su ogni ticker con abbastanza candele
  const patternRows: Array<{
    ticker: string;
    pattern: HSPattern;
    candles: OHLCV[];
  }> = [];
  if (includePatterns) {
    for (const [ticker, candles] of Object.entries(candlesByTicker)) {
      if (candles.length < 60) continue;
      const patterns = detectHeadAndShoulders(candles);
      for (const p of patterns) {
        if (p.strength < 2) continue; // rigoroso: no "in formazione"
        patternRows.push({ ticker, pattern: p, candles });
      }
    }
  }

  const elapsed = Date.now() - t0;

  // Persistenza
  if (persist) {
    const rows: unknown[] = [];

    for (const s of hmaSignals) {
      rows.push({
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
        status: 'ACTIVE',
        entry_price: s.price,
      });
    }

    for (const { ticker, pattern, candles } of patternRows) {
      const last = candles[candles.length - 1];
      rows.push({
        user_id: user.id,
        ticker,
        strategy: pattern.type === 'HS' ? 'PATTERN_HS' : 'PATTERN_IHS',
        strength: pattern.strength,
        price: last.c,
        details: patternDetails(pattern),
        signal_at: new Date(last.t * 1000).toISOString(),
        status: 'ACTIVE',
        entry_price: last.c,
        pattern_data: pattern,
      });
    }

    if (rows.length > 0) {
      await supabase.from('signals').insert(rows);
    }
  }

  const combined: ScanCombined = {
    hmaSignals: hmaSignals.length,
    patternSignals: patternRows.length,
  };

  return NextResponse.json({
    count: hmaSignals.length + patternRows.length,
    scanned: universe.length,
    elapsedMs: elapsed,
    combined,
    signals: hmaSignals,
    patterns: patternRows.map((r) => ({ ticker: r.ticker, ...r.pattern })),
  });
}

function patternDetails(p: HSPattern): string {
  const name = p.type === 'HS' ? 'Testa e Spalle' : 'Inv. Testa e Spalle';
  const dir = p.direction === 'down' ? '↓ ribassista' : '↑ rialzista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${conf} · ${status}`;
}
