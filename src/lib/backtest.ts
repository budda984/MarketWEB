/**
 * Backtest engine.
 *
 * Simula ogni segnale sullo storico candles e calcola P&L con:
 *  - Entry: close della candela di segnale
 *  - Stop loss: default -5%
 *  - Take profit: default +10%
 *  - Time stop: chiudi dopo N giorni se nessuno dei due scatta
 *
 * Restituisce: trade list, equity curve, statistiche.
 */

import type { OHLCV } from './yahoo';
import { evaluateSignal, DEFAULT_STRATEGY, type StrategyConfig } from './signals';

export type BacktestParams = {
  stopLossPct: number; // es. 5 per -5%
  takeProfitPct: number; // es. 10 per +10%
  maxHoldDays: number; // es. 20
  strategy?: StrategyConfig;
};

export const DEFAULT_BACKTEST: BacktestParams = {
  stopLossPct: 5,
  takeProfitPct: 10,
  maxHoldDays: 20,
  strategy: DEFAULT_STRATEGY,
};

export type Trade = {
  ticker: string;
  entryDate: number;
  entryPrice: number;
  exitDate: number;
  exitPrice: number;
  pnlPct: number;
  barsHeld: number;
  outcome: 'TP' | 'SL' | 'TIME';
  strength: number;
};

export type BacktestResult = {
  trades: Trade[];
  equity: Array<{ t: number; value: number }>;
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
    maxDrawdown: number;
    avgBarsHeld: number;
  };
};

/**
 * Esegue backtest su un singolo ticker.
 */
export function backtestTicker(
  ticker: string,
  candles: OHLCV[],
  params: BacktestParams = DEFAULT_BACKTEST
): Trade[] {
  const trades: Trade[] = [];
  const cfg = params.strategy ?? DEFAULT_STRATEGY;
  const slMul = 1 - params.stopLossPct / 100;
  const tpMul = 1 + params.takeProfitPct / 100;

  // Per ogni candela abbastanza avanti, valuta segnale "a quel punto"
  // usando solo candele fino a i (no look-ahead).
  let inPosition = false;
  let entryIdx = 0;
  let entryPrice = 0;
  let strengthAtEntry = 0;

  for (let i = cfg.hmaPeriod + 5; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);

    if (!inPosition) {
      const sig = evaluateSignal(ticker, slice, cfg);
      if (sig && sig.strength >= 2) {
        inPosition = true;
        entryIdx = i;
        entryPrice = candles[i].c;
        strengthAtEntry = sig.strength;
      }
    } else {
      const held = i - entryIdx;
      const cur = candles[i];
      const slPrice = entryPrice * slMul;
      const tpPrice = entryPrice * tpMul;

      let outcome: 'TP' | 'SL' | 'TIME' | null = null;
      let exit = cur.c;

      // Priorità: SL prima di TP se nella stessa candela entrambi toccati
      if (cur.l <= slPrice) {
        outcome = 'SL';
        exit = slPrice;
      } else if (cur.h >= tpPrice) {
        outcome = 'TP';
        exit = tpPrice;
      } else if (held >= params.maxHoldDays) {
        outcome = 'TIME';
        exit = cur.c;
      }

      if (outcome) {
        trades.push({
          ticker,
          entryDate: candles[entryIdx].t,
          entryPrice,
          exitDate: cur.t,
          exitPrice: exit,
          pnlPct: ((exit - entryPrice) / entryPrice) * 100,
          barsHeld: held,
          outcome,
          strength: strengthAtEntry,
        });
        inPosition = false;
      }
    }
  }

  return trades;
}

/**
 * Aggrega trades da più ticker e calcola equity + statistiche.
 */
export function aggregateBacktest(
  tradesByTicker: Record<string, Trade[]>
): BacktestResult {
  const allTrades = Object.values(tradesByTicker).flat();
  allTrades.sort((a, b) => a.exitDate - b.exitDate);

  const equity: Array<{ t: number; value: number }> = [];
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const tr of allTrades) {
    cum += tr.pnlPct;
    equity.push({ t: tr.exitDate, value: cum });
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }

  const wins = allTrades.filter((t) => t.pnlPct > 0).length;
  const losses = allTrades.filter((t) => t.pnlPct <= 0).length;
  const total = allTrades.length;

  return {
    trades: allTrades,
    equity,
    stats: {
      totalTrades: total,
      wins,
      losses,
      winRate: total ? (wins / total) * 100 : 0,
      avgPnl: total ? allTrades.reduce((s, t) => s + t.pnlPct, 0) / total : 0,
      totalPnl: cum,
      maxDrawdown: maxDd,
      avgBarsHeld: total ? allTrades.reduce((s, t) => s + t.barsHeld, 0) / total : 0,
    },
  };
}
