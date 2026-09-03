/**
 * Backtest della regola HMA50 settimanale.
 *
 * REGOLA
 *   Ingresso: la candela settimanale chiude sopra la HMA50
 *   Uscita:   la candela settimanale chiude sotto la HMA50
 * Simmetrica, senza altri filtri: e' la regola cosi' com'e', non una
 * versione ottimizzata. Aggiungere condizioni migliorerebbe i numeri
 * passati senza dire nulla su quelli futuri.
 *
 * DUE SCELTE CHE INFLUENZANO IL RISULTATO
 *
 * 1. La settimana in corso viene sempre scartata: la sua chiusura non e'
 *    definitiva. Valutarla farebbe apparire operazioni che nella realta'
 *    non si sarebbero potute aprire.
 *
 * 2. L'operazione si apre alla chiusura della settimana del segnale, non
 *    all'apertura della successiva. E' un'approssimazione favorevole:
 *    nella realta' si entrerebbe il lunedi' a un prezzo diverso.
 */

import type { OHLCV } from './yahoo';
import { hma } from './indicators';

export type Trade = {
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  /** null se l'operazione e' ancora aperta */
  returnPct: number | null;
  weeks: number;
  open: boolean;
};

export type TickerBacktest = {
  ticker: string;
  trades: Trade[];
  closedTrades: number;
  wins: number;
  losses: number;
  /** Rendimento composto seguendo la regola, in percentuale */
  strategyReturnPct: number;
  /** Rendimento del comprare e tenere nello stesso periodo */
  buyHoldReturnPct: number;
  /** Quota di settimane trascorse in posizione */
  exposurePct: number;
  weeksAnalyzed: number;
  firstDate: string;
  lastDate: string;
};

function weekStartUTC(tsSeconds: number): number {
  const d = new Date(tsSeconds * 1000);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff) / 1000
  );
}

/**
 * Esegue la regola su un titolo. Ritorna null se lo storico non basta
 * per una HMA50 affidabile.
 */
export function backtestWeeklyHma(
  ticker: string,
  weekly: OHLCV[],
  period = 50,
  now: Date = new Date()
): TickerBacktest | null {
  if (weekly.length < period + 20) return null;

  // Scarto la settimana in corso
  const currentWeek = weekStartUTC(Math.floor(now.getTime() / 1000));
  let bars = weekly;
  const last = bars[bars.length - 1];
  if (last && weekStartUTC(last.t) >= currentWeek) bars = bars.slice(0, -1);
  if (bars.length < period + 19) return null;

  const closes = bars.map((c) => c.c);
  const hmaArr = hma(closes, period);

  // Prima barra con HMA disponibile
  let start = hmaArr.findIndex((v) => v != null);
  if (start < 0) return null;
  start = Math.max(start + 1, 1);

  const trades: Trade[] = [];
  let inPosition = false;
  let entryIdx = -1;
  let weeksInPosition = 0;

  const dateOf = (i: number) =>
    new Date(bars[i].t * 1000).toISOString().slice(0, 10);

  for (let i = start; i < bars.length; i++) {
    const h = hmaArr[i];
    const hPrev = hmaArr[i - 1];
    if (h == null || hPrev == null) continue;

    const above = closes[i] > h;
    const abovePrev = closes[i - 1] > hPrev;

    if (!inPosition && above && !abovePrev) {
      // Incrocio al rialzo: apertura
      inPosition = true;
      entryIdx = i;
    } else if (inPosition && !above && abovePrev) {
      // Incrocio al ribasso: chiusura
      const entryPrice = closes[entryIdx];
      const exitPrice = closes[i];
      trades.push({
        entryDate: dateOf(entryIdx),
        entryPrice,
        exitDate: dateOf(i),
        exitPrice,
        returnPct: ((exitPrice - entryPrice) / entryPrice) * 100,
        weeks: i - entryIdx,
        open: false,
      });
      weeksInPosition += i - entryIdx;
      inPosition = false;
    }
  }

  // Operazione ancora aperta alla fine dello storico
  if (inPosition && entryIdx >= 0) {
    const n = bars.length - 1;
    trades.push({
      entryDate: dateOf(entryIdx),
      entryPrice: closes[entryIdx],
      exitDate: null,
      exitPrice: null,
      returnPct: null,
      weeks: n - entryIdx,
      open: true,
    });
    weeksInPosition += n - entryIdx;
  }

  const closed = trades.filter((t) => !t.open && t.returnPct != null);
  const wins = closed.filter((t) => (t.returnPct ?? 0) > 0).length;

  // Rendimento composto delle sole operazioni chiuse
  let equity = 1;
  for (const t of closed) equity *= 1 + (t.returnPct as number) / 100;
  const strategyReturnPct = (equity - 1) * 100;

  const firstClose = closes[start];
  const lastClose = closes[closes.length - 1];
  const buyHoldReturnPct =
    firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const weeksAnalyzed = bars.length - start;

  return {
    ticker,
    trades,
    closedTrades: closed.length,
    wins,
    losses: closed.length - wins,
    strategyReturnPct,
    buyHoldReturnPct,
    exposurePct: weeksAnalyzed > 0 ? (weeksInPosition / weeksAnalyzed) * 100 : 0,
    weeksAnalyzed,
    firstDate: dateOf(start),
    lastDate: dateOf(bars.length - 1),
  };
}

// ============================================================================
// AGGREGAZIONE
// ============================================================================

/**
 * Somme grezze, per poter aggregare piu' chiamate successive senza
 * tenere in memoria tutte le operazioni.
 */
export type BacktestAccumulator = {
  tickers: number;
  closedTrades: number;
  wins: number;
  losses: number;
  sumReturn: number;
  sumSqReturn: number;
  sumWinReturn: number;
  sumLossReturn: number;
  sumWeeks: number;
  bestTrade: number;
  worstTrade: number;
  maxConsecutiveLosses: number;
  sumStrategyReturn: number;
  sumBuyHoldReturn: number;
  sumExposure: number;
  tickersBeatingBuyHold: number;
  openTrades: number;
};

export function emptyAccumulator(): BacktestAccumulator {
  return {
    tickers: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    sumReturn: 0,
    sumSqReturn: 0,
    sumWinReturn: 0,
    sumLossReturn: 0,
    sumWeeks: 0,
    bestTrade: -Infinity,
    worstTrade: Infinity,
    maxConsecutiveLosses: 0,
    sumStrategyReturn: 0,
    sumBuyHoldReturn: 0,
    sumExposure: 0,
    tickersBeatingBuyHold: 0,
    openTrades: 0,
  };
}

export function accumulate(
  acc: BacktestAccumulator,
  r: TickerBacktest
): BacktestAccumulator {
  const out = { ...acc };
  out.tickers += 1;
  out.sumStrategyReturn += r.strategyReturnPct;
  out.sumBuyHoldReturn += r.buyHoldReturnPct;
  out.sumExposure += r.exposurePct;
  if (r.strategyReturnPct > r.buyHoldReturnPct) out.tickersBeatingBuyHold += 1;

  let streak = 0;
  for (const t of r.trades) {
    if (t.open) {
      out.openTrades += 1;
      continue;
    }
    const ret = t.returnPct as number;
    out.closedTrades += 1;
    out.sumReturn += ret;
    out.sumSqReturn += ret * ret;
    out.sumWeeks += t.weeks;
    if (ret > out.bestTrade) out.bestTrade = ret;
    if (ret < out.worstTrade) out.worstTrade = ret;
    if (ret > 0) {
      out.wins += 1;
      out.sumWinReturn += ret;
      streak = 0;
    } else {
      out.losses += 1;
      out.sumLossReturn += ret;
      streak += 1;
      if (streak > out.maxConsecutiveLosses) out.maxConsecutiveLosses = streak;
    }
  }
  return out;
}

export function mergeAccumulators(
  a: BacktestAccumulator,
  b: BacktestAccumulator
): BacktestAccumulator {
  return {
    tickers: a.tickers + b.tickers,
    closedTrades: a.closedTrades + b.closedTrades,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    sumReturn: a.sumReturn + b.sumReturn,
    sumSqReturn: a.sumSqReturn + b.sumSqReturn,
    sumWinReturn: a.sumWinReturn + b.sumWinReturn,
    sumLossReturn: a.sumLossReturn + b.sumLossReturn,
    sumWeeks: a.sumWeeks + b.sumWeeks,
    bestTrade: Math.max(a.bestTrade, b.bestTrade),
    worstTrade: Math.min(a.worstTrade, b.worstTrade),
    maxConsecutiveLosses: Math.max(a.maxConsecutiveLosses, b.maxConsecutiveLosses),
    sumStrategyReturn: a.sumStrategyReturn + b.sumStrategyReturn,
    sumBuyHoldReturn: a.sumBuyHoldReturn + b.sumBuyHoldReturn,
    sumExposure: a.sumExposure + b.sumExposure,
    tickersBeatingBuyHold: a.tickersBeatingBuyHold + b.tickersBeatingBuyHold,
    openTrades: a.openTrades + b.openTrades,
  };
}

export type BacktestSummary = {
  tickers: number;
  closedTrades: number;
  openTrades: number;
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  /** Somma dei guadagni divisa per somma delle perdite. Sotto 1 la
   *  regola perde denaro */
  profitFactor: number | null;
  avgWeeks: number;
  bestTrade: number;
  worstTrade: number;
  maxConsecutiveLosses: number;
  avgStrategyReturn: number;
  avgBuyHoldReturn: number;
  avgExposure: number;
  beatBuyHoldPct: number;
};

export function summarize(acc: BacktestAccumulator): BacktestSummary {
  const n = acc.closedTrades;
  const lossSum = Math.abs(acc.sumLossReturn);
  return {
    tickers: acc.tickers,
    closedTrades: n,
    openTrades: acc.openTrades,
    winRate: n > 0 ? (acc.wins / n) * 100 : 0,
    avgReturn: n > 0 ? acc.sumReturn / n : 0,
    avgWin: acc.wins > 0 ? acc.sumWinReturn / acc.wins : 0,
    avgLoss: acc.losses > 0 ? acc.sumLossReturn / acc.losses : 0,
    profitFactor: lossSum > 0 ? acc.sumWinReturn / lossSum : null,
    avgWeeks: n > 0 ? acc.sumWeeks / n : 0,
    bestTrade: Number.isFinite(acc.bestTrade) ? acc.bestTrade : 0,
    worstTrade: Number.isFinite(acc.worstTrade) ? acc.worstTrade : 0,
    maxConsecutiveLosses: acc.maxConsecutiveLosses,
    avgStrategyReturn: acc.tickers > 0 ? acc.sumStrategyReturn / acc.tickers : 0,
    avgBuyHoldReturn: acc.tickers > 0 ? acc.sumBuyHoldReturn / acc.tickers : 0,
    avgExposure: acc.tickers > 0 ? acc.sumExposure / acc.tickers : 0,
    beatBuyHoldPct:
      acc.tickers > 0 ? (acc.tickersBeatingBuyHold / acc.tickers) * 100 : 0,
  };
}
