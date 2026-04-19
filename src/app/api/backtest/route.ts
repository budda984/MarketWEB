import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownloadMany } from '@/lib/yahoo';
import {
  backtestTicker,
  aggregateBacktest,
  DEFAULT_BACKTEST,
  type BacktestParams,
} from '@/lib/backtest';
import { MARKETS, type MarketKey, ALL_TICKERS } from '@/lib/tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  markets?: MarketKey[];
  tickers?: string[];
  params?: Partial<BacktestParams>;
  period?: '6mo' | '1y' | '2y' | '5y';
  saveAs?: string | null;
};

/**
 * POST /api/backtest
 * Esegue backtest sull'universo scelto.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const params: BacktestParams = { ...DEFAULT_BACKTEST, ...(body.params ?? {}) };
  const period = body.period ?? '1y';

  let universe: string[];
  if (body.tickers && body.tickers.length > 0) {
    universe = body.tickers;
  } else if (body.markets && body.markets.length > 0) {
    universe = Array.from(
      new Set(body.markets.flatMap((m) => MARKETS[m] ?? []))
    );
  } else {
    universe = ALL_TICKERS.slice(0, 50); // limita di default
  }

  const candlesByTicker = await yahooDownloadMany(universe, period, '1d', 12);
  const tradesByTicker: Record<string, ReturnType<typeof backtestTicker>> = {};
  for (const [t, candles] of Object.entries(candlesByTicker)) {
    if (candles.length > 0) {
      tradesByTicker[t] = backtestTicker(t, candles, params);
    }
  }

  const result = aggregateBacktest(tradesByTicker);

  if (body.saveAs) {
    await supabase.from('backtest_results').insert({
      user_id: user.id,
      name: body.saveAs,
      strategy: 'HMA50_HA',
      params: params as unknown as Record<string, unknown>,
      universe,
      total_trades: result.stats.totalTrades,
      win_rate: result.stats.winRate,
      total_pnl: result.stats.totalPnl,
      max_drawdown: result.stats.maxDrawdown,
      avg_bars_held: result.stats.avgBarsHeld,
      trades: result.trades,
      equity: result.equity,
    });
  }

  return NextResponse.json(result);
}
