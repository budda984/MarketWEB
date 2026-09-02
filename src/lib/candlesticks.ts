/**
 * Riconoscimento di pattern a candele e verifica statistica.
 *
 * IMPOSTAZIONE DEL TEST
 * La domanda non e' "dopo il pattern il titolo scende?" ma "scende PIU'
 * di quanto scenderebbe in un giorno qualsiasi?". Un pattern che compare
 * soprattutto nelle fasi deboli sembrerebbe predittivo pur limitandosi a
 * fotografare il contesto. Per questo ogni rendimento successivo al
 * segnale viene confrontato con la distribuzione di TUTTI i rendimenti
 * dello stesso titolo sullo stesso orizzonte.
 */

import type { OHLCV } from './yahoo';
import { sma } from './screener';

export type EngulfingOptions = {
  /** Il corpo della candela ribassista deve superare il precedente di
   *  questo fattore (1 = semplice inglobamento) */
  minBodyRatio: number;
  /** Richiede un rialzo precedente: il pattern di inversione ha senso
   *  solo dopo una salita */
  requirePriorUptrend: boolean;
  /** Barre su cui misurare il rialzo precedente */
  uptrendLookback: number;
  /** Rialzo minimo percentuale nelle barre precedenti */
  uptrendMinPct: number;
  /** Corpo minimo della candela ribassista, in percentuale sul prezzo:
   *  esclude i pattern su candele minuscole, che sono rumore */
  minBodyPct: number;
};

export const DEFAULT_ENGULFING: EngulfingOptions = {
  minBodyRatio: 1.0,
  requirePriorUptrend: true,
  uptrendLookback: 10,
  uptrendMinPct: 2,
  minBodyPct: 0.5,
};

export type EngulfingEvent = {
  idx: number;
  date: string;
  close: number;
  bodyRatio: number;
  priorRisePct: number;
};

/**
 * Engulfing ribassista: candela rialzista seguita da una ribassista il
 * cui corpo ingloba interamente il corpo precedente.
 *
 * Si confrontano i CORPI (apertura-chiusura), non le ombre: e' la
 * definizione classica e la piu' usata in letteratura.
 */
export function detectBearishEngulfing(
  candles: OHLCV[],
  opts: Partial<EngulfingOptions> = {}
): EngulfingEvent[] {
  const o = { ...DEFAULT_ENGULFING, ...opts };
  const out: EngulfingEvent[] = [];
  if (candles.length < o.uptrendLookback + 5) return out;

  const start = o.requirePriorUptrend ? o.uptrendLookback : 1;

  for (let i = start; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];

    // La precedente deve essere rialzista, la corrente ribassista
    if (prev.c <= prev.o) continue;
    if (cur.c >= cur.o) continue;

    const prevBody = prev.c - prev.o;
    const curBody = cur.o - cur.c;
    if (prevBody <= 0 || curBody <= 0) continue;

    // Inglobamento del corpo
    if (cur.o < prev.c) continue;
    if (cur.c > prev.o) continue;

    const bodyRatio = curBody / prevBody;
    if (bodyRatio < o.minBodyRatio) continue;

    // Corpo non trascurabile rispetto al prezzo
    if ((curBody / cur.c) * 100 < o.minBodyPct) continue;

    // Rialzo precedente
    let priorRisePct = 0;
    if (o.requirePriorUptrend) {
      const refIdx = i - o.uptrendLookback;
      if (refIdx < 0) continue;
      const ref = candles[refIdx].c;
      if (ref <= 0) continue;
      priorRisePct = ((prev.c - ref) / ref) * 100;
      if (priorRisePct < o.uptrendMinPct) continue;
    }

    out.push({
      idx: i,
      date: new Date(cur.t * 1000).toISOString().slice(0, 10),
      close: cur.c,
      bodyRatio,
      priorRisePct,
    });
  }

  return out;
}

// ============================================================================
// STATISTICHE
// ============================================================================

/**
 * Accumulatore per un singolo orizzonte temporale. Si sommano i valori
 * grezzi cosi' che l'aggregazione possa avvenire su piu' chiamate
 * successive senza tenere in memoria tutti i rendimenti.
 */
export type HorizonAcc = {
  n: number;
  sum: number;
  sumSq: number;
  negatives: number;
};

export function emptyAcc(): HorizonAcc {
  return { n: 0, sum: 0, sumSq: 0, negatives: 0 };
}

export function addToAcc(acc: HorizonAcc, value: number): void {
  acc.n += 1;
  acc.sum += value;
  acc.sumSq += value * value;
  if (value < 0) acc.negatives += 1;
}

export function mergeAcc(a: HorizonAcc, b: HorizonAcc): HorizonAcc {
  return {
    n: a.n + b.n,
    sum: a.sum + b.sum,
    sumSq: a.sumSq + b.sumSq,
    negatives: a.negatives + b.negatives,
  };
}

export type HorizonStats = {
  n: number;
  mean: number;
  stdDev: number;
  negativeRate: number;
};

export function statsFrom(acc: HorizonAcc): HorizonStats {
  if (acc.n === 0) {
    return { n: 0, mean: 0, stdDev: 0, negativeRate: 0 };
  }
  const mean = acc.sum / acc.n;
  const variance = Math.max(0, acc.sumSq / acc.n - mean * mean);
  return {
    n: acc.n,
    mean,
    stdDev: Math.sqrt(variance),
    negativeRate: acc.negatives / acc.n,
  };
}

/**
 * Statistica t per la differenza fra due medie indipendenti.
 * Con migliaia di osservazioni, |t| sotto 2 indica una differenza non
 * distinguibile dal caso.
 */
export function tStatistic(a: HorizonStats, b: HorizonStats): number | null {
  if (a.n < 2 || b.n < 2) return null;
  const se = Math.sqrt((a.stdDev * a.stdDev) / a.n + (b.stdDev * b.stdDev) / b.n);
  if (se === 0) return null;
  return (a.mean - b.mean) / se;
}

export const HORIZONS = [1, 5, 10, 20] as const;
export type Horizon = (typeof HORIZONS)[number];

export type TickerBacktestResult = {
  ticker: string;
  events: number;
  bars: number;
  signal: Record<number, HorizonAcc>;
  baseline: Record<number, HorizonAcc>;
};

/**
 * Analizza un titolo: raccoglie i rendimenti successivi ai segnali e,
 * separatamente, quelli successivi a TUTTE le barre. Il secondo insieme
 * e' il termine di paragone.
 */
export function backtestEngulfing(
  ticker: string,
  candles: OHLCV[],
  opts: Partial<EngulfingOptions> = {}
): TickerBacktestResult | null {
  const maxH = Math.max(...HORIZONS);
  if (candles.length < 60 + maxH) return null;

  const events = detectBearishEngulfing(candles, opts);

  const signal: Record<number, HorizonAcc> = {};
  const baseline: Record<number, HorizonAcc> = {};
  for (const h of HORIZONS) {
    signal[h] = emptyAcc();
    baseline[h] = emptyAcc();
  }

  const fwd = (i: number, h: number): number | null => {
    const j = i + h;
    if (j >= candles.length) return null;
    const a = candles[i].c;
    const b = candles[j].c;
    if (!a || a <= 0 || !b) return null;
    return ((b - a) / a) * 100;
  };

  const eventIdx = new Set(events.map((e) => e.idx));

  for (const h of HORIZONS) {
    // Base: ogni barra utilizzabile, indipendentemente dal pattern.
    // Si parte dalla stessa barra minima usata per i segnali cosi' che i
    // due insiemi coprano lo stesso periodo.
    for (let i = 10; i < candles.length - h; i++) {
      const r = fwd(i, h);
      if (r == null || !Number.isFinite(r)) continue;
      addToAcc(baseline[h], r);
      if (eventIdx.has(i)) addToAcc(signal[h], r);
    }
  }

  return {
    ticker,
    events: events.length,
    bars: candles.length,
    signal,
    baseline,
  };
}

/** Media mobile riesportata per comodita' d'uso nel modulo. */
export { sma };
