/**
 * Verifica statistica dei pattern grafici.
 *
 * PERCHE' MISURARE INVECE DI ELENCARE
 * Un rilevatore che produce cento figure non dimostra nulla: le figure
 * ci sono sempre, in qualunque grafico. La domanda e' se dopo una figura
 * succeda qualcosa di diverso da quanto succede in un giorno qualsiasi.
 * Senza questo confronto non c'e' modo di sapere se una taratura sia
 * migliore di un'altra.
 *
 * L'ERRORE DA EVITARE
 * Un massimo o un minimo strutturale e' riconoscibile solo dopo che sono
 * passate le barre di conferma: al momento in cui si forma nessuno puo'
 * saperlo. Misurare il rendimento a partire dall'ultimo minimo della
 * figura significherebbe usare informazioni non disponibili allora, e
 * produrrebbe risultati ottimi e falsi. Qui il conteggio parte dalla
 * prima seduta in cui la figura era effettivamente visibile.
 */

import type { OHLCV } from './yahoo';
import {
  detectHeadAndShoulders,
  detectDoubleTopBottom,
  type HSPattern,
  type DoublePattern,
} from './patterns';

export const HORIZONS = [5, 10, 20, 60] as const;

/** Barre di conferma richieste dai pivot: ritardo minimo di visibilita'. */
const CONFIRM_BARS = 10;

export type PatternKind = 'IHS' | 'DOUBLE_BOTTOM';

export const PATTERN_LABELS: Record<PatternKind, string> = {
  IHS: 'Testa e spalle rovesciato',
  DOUBLE_BOTTOM: 'Doppio minimo',
};

export type Acc = {
  n: number;
  sum: number;
  sumSq: number;
  positives: number;
};

export const emptyAcc = (): Acc => ({ n: 0, sum: 0, sumSq: 0, positives: 0 });

export function addAcc(a: Acc, v: number): void {
  a.n += 1;
  a.sum += v;
  a.sumSq += v * v;
  if (v > 0) a.positives += 1;
}

export function mergeAcc(a: Acc, b: Acc): Acc {
  return {
    n: a.n + b.n,
    sum: a.sum + b.sum,
    sumSq: a.sumSq + b.sumSq,
    positives: a.positives + b.positives,
  };
}

export type Stats = {
  n: number;
  mean: number;
  stdDev: number;
  positiveRate: number;
};

export function statsOf(a: Acc): Stats {
  if (a.n === 0) return { n: 0, mean: 0, stdDev: 0, positiveRate: 0 };
  const mean = a.sum / a.n;
  const varc = Math.max(0, a.sumSq / a.n - mean * mean);
  return {
    n: a.n,
    mean,
    stdDev: Math.sqrt(varc),
    positiveRate: a.positives / a.n,
  };
}

/**
 * Statistica t per la differenza fra due medie. Con molte osservazioni,
 * sotto 2 in valore assoluto la differenza non e' distinguibile dal caso.
 */
export function tStat(a: Stats, b: Stats): number | null {
  if (a.n < 2 || b.n < 2) return null;
  const se = Math.sqrt(
    (a.stdDev * a.stdDev) / a.n + (b.stdDev * b.stdDev) / b.n
  );
  if (se === 0) return null;
  return (a.mean - b.mean) / se;
}

export type PatternSample = {
  ticker: string;
  kind: PatternKind;
  /** Data dell'ultimo minimo della figura */
  formedDate: string;
  /** Data in cui la figura era effettivamente visibile */
  visibleDate: string;
  confidence: number;
  /** Rendimento a 20 sedute dalla visibilita', se disponibile */
  return20: number | null;
};

export type TickerResult = {
  ticker: string;
  events: Record<PatternKind, number>;
  signal: Record<PatternKind, Record<number, Acc>>;
  baseline: Record<number, Acc>;
  samples: PatternSample[];
};

function emptySignal(): Record<PatternKind, Record<number, Acc>> {
  const out = {} as Record<PatternKind, Record<number, Acc>>;
  for (const k of ['IHS', 'DOUBLE_BOTTOM'] as PatternKind[]) {
    out[k] = {};
    for (const h of HORIZONS) out[k][h] = emptyAcc();
  }
  return out;
}

export function testPatterns(
  ticker: string,
  candles: OHLCV[]
): TickerResult | null {
  const maxH = Math.max(...HORIZONS);
  if (candles.length < 150 + maxH) return null;

  const closes = candles.map((c) => c.c);
  const lastIdx = candles.length - 1;

  const fwd = (from: number, h: number): number | null => {
    const to = from + h;
    if (to > lastIdx) return null;
    const a = closes[from];
    const b = closes[to];
    if (!a || a <= 0 || !b) return null;
    return ((b - a) / a) * 100;
  };

  const isoDate = (i: number) =>
    new Date(candles[i].t * 1000).toISOString().slice(0, 10);

  // --- Rilevamento -----------------------------------------------------
  const hs: HSPattern[] = detectHeadAndShoulders(candles).filter(
    (p) => p.type === 'IHS'
  );
  const db: DoublePattern[] = detectDoubleTopBottom(candles).filter(
    (p) => p.type === 'DOUBLE_BOTTOM'
  );

  const signal = emptySignal();
  const baseline: Record<number, Acc> = {};
  for (const h of HORIZONS) baseline[h] = emptyAcc();

  const events: Record<PatternKind, number> = { IHS: 0, DOUBLE_BOTTOM: 0 };
  const samples: PatternSample[] = [];

  function record(
    kind: PatternKind,
    endIdx: number,
    confidence: number
  ): void {
    // La figura e' visibile solo dopo le barre di conferma dei pivot
    const visibleIdx = endIdx + CONFIRM_BARS;
    if (visibleIdx > lastIdx) return;
    events[kind] += 1;

    for (const h of HORIZONS) {
      const r = fwd(visibleIdx, h);
      if (r != null && Number.isFinite(r)) addAcc(signal[kind][h], r);
    }

    samples.push({
      ticker,
      kind,
      formedDate: isoDate(endIdx),
      visibleDate: isoDate(visibleIdx),
      confidence,
      return20: fwd(visibleIdx, 20),
    });
  }

  for (const p of hs) record('IHS', p.endIdx, p.confidence);
  for (const p of db) record('DOUBLE_BOTTOM', p.endIdx, p.confidence);

  // --- Termine di paragone ---------------------------------------------
  // Tutte le sedute dello stesso titolo, cosi' il confronto avviene sullo
  // stesso periodo e sullo stesso strumento
  for (const h of HORIZONS) {
    for (let i = 20; i <= lastIdx - h; i++) {
      const r = fwd(i, h);
      if (r != null && Number.isFinite(r)) addAcc(baseline[h], r);
    }
  }

  return { ticker, events, signal, baseline, samples };
}
