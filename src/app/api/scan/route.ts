import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany, type OHLCV } from '@/lib/yahoo';
import { scanTickers, type SignalStrength } from '@/lib/signals';
import {
  detectHeadAndShoulders,
  detectFlags,
  detectWedges,
  detectCupHandle,
  type HSPattern,
  type FlagPattern,
  type WedgePattern,
  type CupHandlePattern,
} from '@/lib/patterns';
import { MARKETS, type MarketKey, ALL_TICKERS } from '@/lib/tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  tickers?: string[];
  minStrength?: SignalStrength;
  persist?: boolean;
  includePatterns?: boolean;
};

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const minStrength = (body.minStrength ?? 1) as SignalStrength;
  const persist = body.persist ?? false;
  const includePatterns = body.includePatterns ?? true;

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
  const candlesByTicker = await yahooDownloadMany(universe, '6mo', '1d', 12);
  const hmaSignals = await scanTickers(candlesByTicker, minStrength);

  type HSRow = { ticker: string; pattern: HSPattern; candles: OHLCV[] };
  type FlagRow = { ticker: string; pattern: FlagPattern; candles: OHLCV[] };
  type WedgeRow = { ticker: string; pattern: WedgePattern; candles: OHLCV[] };
  type CupRow = { ticker: string; pattern: CupHandlePattern; candles: OHLCV[] };

  const hsRows: HSRow[] = [];
  const flagRows: FlagRow[] = [];
  const wedgeRows: WedgeRow[] = [];
  const cupRows: CupRow[] = [];

  if (includePatterns) {
    for (const [ticker, candles] of Object.entries(candlesByTicker)) {
      if (candles.length < 60) continue;

      for (const p of detectHeadAndShoulders(candles)) {
        if (p.strength >= 2) hsRows.push({ ticker, pattern: p, candles });
      }
      for (const p of detectFlags(candles)) {
        if (p.strength >= 2) flagRows.push({ ticker, pattern: p, candles });
      }
      for (const p of detectWedges(candles)) {
        if (p.strength >= 2) wedgeRows.push({ ticker, pattern: p, candles });
      }
      for (const p of detectCupHandle(candles)) {
        if (p.strength >= 2) cupRows.push({ ticker, pattern: p, candles });
      }
    }
  }

  const elapsed = Date.now() - t0;

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

    for (const { ticker, pattern, candles } of hsRows) {
      const last = candles[candles.length - 1];
      rows.push({
        user_id: user.id,
        ticker,
        strategy: pattern.type === 'HS' ? 'PATTERN_HS' : 'PATTERN_IHS',
        strength: pattern.strength,
        price: last.c,
        details: hsDetails(pattern),
        signal_at: new Date(last.t * 1000).toISOString(),
        status: 'ACTIVE',
        entry_price: last.c,
        pattern_data: pattern,
      });
    }

    for (const { ticker, pattern, candles } of flagRows) {
      const last = candles[candles.length - 1];
      rows.push({
        user_id: user.id,
        ticker,
        strategy:
          pattern.type === 'BULL_FLAG' ? 'PATTERN_BULL_FLAG' : 'PATTERN_BEAR_FLAG',
        strength: pattern.strength,
        price: last.c,
        details: flagDetails(pattern),
        signal_at: new Date(last.t * 1000).toISOString(),
        status: 'ACTIVE',
        entry_price: last.c,
        pattern_data: pattern,
      });
    }

    for (const { ticker, pattern, candles } of wedgeRows) {
      const last = candles[candles.length - 1];
      rows.push({
        user_id: user.id,
        ticker,
        strategy:
          pattern.type === 'RISING_WEDGE'
            ? 'PATTERN_RISING_WEDGE'
            : 'PATTERN_FALLING_WEDGE',
        strength: pattern.strength,
        price: last.c,
        details: wedgeDetails(pattern),
        signal_at: new Date(last.t * 1000).toISOString(),
        status: 'ACTIVE',
        entry_price: last.c,
        pattern_data: pattern,
      });
    }

    for (const { ticker, pattern, candles } of cupRows) {
      const last = candles[candles.length - 1];
      rows.push({
        user_id: user.id,
        ticker,
        strategy: 'PATTERN_CUP_HANDLE',
        strength: pattern.strength,
        price: last.c,
        details: cupDetails(pattern),
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

  return NextResponse.json({
    count:
      hmaSignals.length +
      hsRows.length +
      flagRows.length +
      wedgeRows.length +
      cupRows.length,
    scanned: universe.length,
    elapsedMs: elapsed,
    combined: {
      hmaSignals: hmaSignals.length,
      hsPatterns: hsRows.length,
      flagPatterns: flagRows.length,
      wedgePatterns: wedgeRows.length,
      cupPatterns: cupRows.length,
    },
    signals: hmaSignals,
    patterns: [
      ...hsRows.map((r) => ({ ticker: r.ticker, ...r.pattern })),
      ...flagRows.map((r) => ({ ticker: r.ticker, ...r.pattern })),
      ...wedgeRows.map((r) => ({ ticker: r.ticker, ...r.pattern })),
      ...cupRows.map((r) => ({ ticker: r.ticker, ...r.pattern })),
    ],
  });
}

function hsDetails(p: HSPattern): string {
  const name = p.type === 'HS' ? 'Testa e Spalle' : 'Inv. Testa e Spalle';
  const dir = p.direction === 'down' ? '↓ ribassista' : '↑ rialzista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${conf} · ${status}`;
}

function flagDetails(p: FlagPattern): string {
  const name = p.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag';
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  const pole = `pole ${p.poleChangePct >= 0 ? '+' : ''}${p.poleChangePct.toFixed(1)}%`;
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${pole} · ${conf} · ${status}`;
}

function wedgeDetails(p: WedgePattern): string {
  const name = p.type === 'RISING_WEDGE' ? 'Rising Wedge' : 'Falling Wedge';
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${conf} · ${status}`;
}

function cupDetails(p: CupHandlePattern): string {
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const depth = `cup ${p.cupDepthPct.toFixed(1)}% · handle ${p.handleDepthPct.toFixed(1)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `Cup & Handle · ↑ rialzista · ${depth} · ${conf} · ${status}`;
}
