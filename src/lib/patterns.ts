/**
 * Pattern recognition engine — Fase 1: Head & Shoulders (e inverse).
 *
 * Parametri rigorosi (pochi pattern ma di alta qualità):
 *  - Pivot: leftBars = rightBars = 5 (massimo/minimo di 2 settimane)
 *  - Spalla: deve essere ≥ 2% sotto la testa
 *  - Simmetria spalle: |LS - RS| / H ≤ 8%
 *  - Neckline: quasi orizzontale (|NLleft - NLright| / avg ≤ 5%)
 *  - Durata: 10-80 candele fra spalla sx e dx
 *  - Confidence minima: 0.7
 *
 * Strength:
 *  - 3 = breakout confermato (close oltre neckline ≤ 2 candele fa)
 *  - 2 = pattern formato, in attesa di breakout
 *  - 1 = in formazione (solo se minStrength=1, di default escluso)
 */

import type { OHLCV } from './yahoo';

export type Pivot = {
  idx: number;
  price: number;
  type: 'high' | 'low';
};

export type HSPattern = {
  type: 'HS' | 'IHS';
  startIdx: number;
  endIdx: number;
  keyPoints: Pivot[];
  necklineLeft: { idx: number; price: number };
  necklineRight: { idx: number; price: number };
  necklineAtLastBar: number;
  breakoutLevel: number;
  direction: 'down' | 'up';
  breakoutConfirmed: boolean;
  breakoutBarsAgo: number | null;
  confidence: number;
  target: number;
  stopLoss: number;
  strength: 1 | 2 | 3;
  lastPrice: number;
};

/**
 * Pivot detection: una candela è pivot high se il suo high è > degli N
 * high precedenti E degli N successivi. Idem per i pivot low.
 */
export function findPivots(
  candles: OHLCV[],
  leftBars = 5,
  rightBars = 5
): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const cur = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= leftBars; k++) {
      if (candles[i - k].h >= cur.h) isHigh = false;
      if (candles[i - k].l <= cur.l) isLow = false;
    }
    for (let k = 1; k <= rightBars; k++) {
      if (candles[i + k].h >= cur.h) isHigh = false;
      if (candles[i + k].l <= cur.l) isLow = false;
    }
    if (isHigh) pivots.push({ idx: i, price: cur.h, type: 'high' });
    if (isLow) pivots.push({ idx: i, price: cur.l, type: 'low' });
  }
  return pivots;
}

type HSOpts = {
  leftBars?: number;
  rightBars?: number;
  minConfidence?: number;
  shoulderSymmetryMax?: number; // default 0.08 (8%)
  necklineSlopeMax?: number; // default 0.05 (5%)
  headOverShoulderMin?: number; // default 0.02 (2%)
  durationMin?: number;
  durationMax?: number;
  breakoutWindow?: number; // quante barre recenti cercare il breakout
};

const DEFAULT_OPTS: Required<HSOpts> = {
  leftBars: 5,
  rightBars: 5,
  minConfidence: 0.7,
  shoulderSymmetryMax: 0.08,
  necklineSlopeMax: 0.05,
  headOverShoulderMin: 0.02,
  durationMin: 10,
  durationMax: 80,
  breakoutWindow: 5,
};

/**
 * Detection di Head & Shoulders (top + inverse).
 */
export function detectHeadAndShoulders(
  candles: OHLCV[],
  userOpts: HSOpts = {}
): HSPattern[] {
  const opts = { ...DEFAULT_OPTS, ...userOpts };
  if (candles.length < opts.durationMin + opts.leftBars + opts.rightBars + 10) {
    return [];
  }

  const pivots = findPivots(candles, opts.leftBars, opts.rightBars);
  const highs = pivots.filter((p) => p.type === 'high');
  const lows = pivots.filter((p) => p.type === 'low');

  const matches: HSPattern[] = [];
  const lastIdx = candles.length - 1;
  const lastPrice = candles[lastIdx].c;

  // --- H&S TOP (ribassista) ---
  for (let i = 2; i < highs.length; i++) {
    const LS = highs[i - 2];
    const H = highs[i - 1];
    const RS = highs[i];

    // Head > spalle di almeno la soglia
    if (H.price < LS.price * (1 + opts.headOverShoulderMin)) continue;
    if (H.price < RS.price * (1 + opts.headOverShoulderMin)) continue;

    // Durata
    const duration = RS.idx - LS.idx;
    if (duration < opts.durationMin || duration > opts.durationMax) continue;

    // Simmetria spalle
    const shoulderDiff = Math.abs(LS.price - RS.price) / H.price;
    if (shoulderDiff > opts.shoulderSymmetryMax) continue;

    // Neckline: 2 pivot low fra LS-H e H-RS
    const NL_left = lows.find((l) => l.idx > LS.idx && l.idx < H.idx);
    const NL_right = lows.find((l) => l.idx > H.idx && l.idx < RS.idx);
    if (!NL_left || !NL_right) continue;

    // Neckline quasi orizzontale
    const avgNL = (NL_left.price + NL_right.price) / 2;
    const nlDiff = Math.abs(NL_left.price - NL_right.price) / avgNL;
    if (nlDiff > opts.necklineSlopeMax) continue;

    // Confidence
    const symmetry = 1 - shoulderDiff / opts.shoulderSymmetryMax;
    const horiz = 1 - nlDiff / opts.necklineSlopeMax;
    const confidence = (symmetry + horiz) / 2;
    if (confidence < opts.minConfidence) continue;

    // Neckline estesa alla candela corrente
    const slope =
      (NL_right.price - NL_left.price) / (NL_right.idx - NL_left.idx);
    const necklineAtLast = NL_right.price + slope * (lastIdx - NL_right.idx);

    // Breakout: close < neckline nelle ultime N candele dopo RS
    let breakoutBarsAgo: number | null = null;
    const maxK = Math.min(opts.breakoutWindow, lastIdx - RS.idx);
    for (let k = 0; k <= maxK; k++) {
      const barIdx = lastIdx - k;
      if (barIdx <= RS.idx) break;
      const bar = candles[barIdx];
      const nlAtBar = NL_right.price + slope * (barIdx - NL_right.idx);
      if (bar.c < nlAtBar) {
        breakoutBarsAgo = k;
        break;
      }
    }

    // Strength rigorosa: min 2 (pattern completo), 3 se breakout ≤ 2d
    let strength: 1 | 2 | 3 = 2;
    if (breakoutBarsAgo !== null && breakoutBarsAgo <= 2) strength = 3;

    const target = necklineAtLast - (H.price - necklineAtLast);
    const stopLoss = H.price * 1.005;

    matches.push({
      type: 'HS',
      startIdx: LS.idx,
      endIdx: RS.idx,
      keyPoints: [LS, NL_left, H, NL_right, RS],
      necklineLeft: NL_left,
      necklineRight: NL_right,
      necklineAtLastBar: necklineAtLast,
      breakoutLevel: necklineAtLast,
      direction: 'down',
      breakoutConfirmed: breakoutBarsAgo !== null,
      breakoutBarsAgo,
      confidence,
      target,
      stopLoss,
      strength,
      lastPrice,
    });
  }

  // --- IHS BOTTOM (rialzista, speculare) ---
  for (let i = 2; i < lows.length; i++) {
    const LS = lows[i - 2];
    const H = lows[i - 1]; // head = punto più basso
    const RS = lows[i];

    if (H.price > LS.price * (1 - opts.headOverShoulderMin)) continue;
    if (H.price > RS.price * (1 - opts.headOverShoulderMin)) continue;

    const duration = RS.idx - LS.idx;
    if (duration < opts.durationMin || duration > opts.durationMax) continue;

    const shoulderDiff = Math.abs(LS.price - RS.price) / H.price;
    if (shoulderDiff > opts.shoulderSymmetryMax) continue;

    // Neckline sopra: 2 pivot high fra LS-H e H-RS
    const NL_left = highs.find((h) => h.idx > LS.idx && h.idx < H.idx);
    const NL_right = highs.find((h) => h.idx > H.idx && h.idx < RS.idx);
    if (!NL_left || !NL_right) continue;

    const avgNL = (NL_left.price + NL_right.price) / 2;
    const nlDiff = Math.abs(NL_left.price - NL_right.price) / avgNL;
    if (nlDiff > opts.necklineSlopeMax) continue;

    const symmetry = 1 - shoulderDiff / opts.shoulderSymmetryMax;
    const horiz = 1 - nlDiff / opts.necklineSlopeMax;
    const confidence = (symmetry + horiz) / 2;
    if (confidence < opts.minConfidence) continue;

    const slope =
      (NL_right.price - NL_left.price) / (NL_right.idx - NL_left.idx);
    const necklineAtLast = NL_right.price + slope * (lastIdx - NL_right.idx);

    let breakoutBarsAgo: number | null = null;
    const maxK = Math.min(opts.breakoutWindow, lastIdx - RS.idx);
    for (let k = 0; k <= maxK; k++) {
      const barIdx = lastIdx - k;
      if (barIdx <= RS.idx) break;
      const bar = candles[barIdx];
      const nlAtBar = NL_right.price + slope * (barIdx - NL_right.idx);
      if (bar.c > nlAtBar) {
        breakoutBarsAgo = k;
        break;
      }
    }

    let strength: 1 | 2 | 3 = 2;
    if (breakoutBarsAgo !== null && breakoutBarsAgo <= 2) strength = 3;

    const target = necklineAtLast + (necklineAtLast - H.price);
    const stopLoss = H.price * 0.995;

    matches.push({
      type: 'IHS',
      startIdx: LS.idx,
      endIdx: RS.idx,
      keyPoints: [LS, NL_left, H, NL_right, RS],
      necklineLeft: NL_left,
      necklineRight: NL_right,
      necklineAtLastBar: necklineAtLast,
      breakoutLevel: necklineAtLast,
      direction: 'up',
      breakoutConfirmed: breakoutBarsAgo !== null,
      breakoutBarsAgo,
      confidence,
      target,
      stopLoss,
      strength,
      lastPrice,
    });
  }

  // Dedup: se due pattern si sovrappongono, tieni il più recente e confidente
  matches.sort((a, b) => b.endIdx - a.endIdx || b.confidence - a.confidence);
  const deduped: HSPattern[] = [];
  const usedRanges: Array<[number, number]> = [];
  for (const m of matches) {
    const overlap = usedRanges.some(
      ([s, e]) => m.startIdx < e && m.endIdx > s
    );
    if (!overlap) {
      deduped.push(m);
      usedRanges.push([m.startIdx, m.endIdx]);
    }
  }

  return deduped;
}
