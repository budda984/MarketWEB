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

// ============================================================================
// FLAG PATTERN (Bull / Bear) — Fase 2
// ============================================================================
/**
 * Flag: pattern di continuazione in due fasi.
 *  1. POLE: movimento direzionale forte, ≥10% in 3-8 candele, basso pullback
 *  2. FLAG: consolidamento subito dopo il pole, 5-15 candele, canale
 *     lievemente contrario al pole (retracement ≤50% del pole)
 *  3. BREAKOUT: close oltre la trendline superiore del canale (bull)
 *     o inferiore (bear), nella direzione del pole
 *
 * Parametri rigorosi:
 *  - Pole: min 10% di movimento, 3-8 candele, pullback interno ≤30% del move
 *  - Flag: 5-15 candele, retracement totale ≤50% del pole
 *  - Canale: slope contraria al pole, con tolleranza
 *  - Confidence minima: 0.7
 *
 * Strength:
 *  - 3 = breakout confermato (close oltre canale ≤ 2 candele fa)
 *  - 2 = flag formata, in attesa breakout
 */

export type FlagPattern = {
  type: 'BULL_FLAG' | 'BEAR_FLAG';
  startIdx: number; // inizio pole
  poleEndIdx: number; // fine pole = inizio flag
  endIdx: number; // fine flag
  poleStartPrice: number;
  poleEndPrice: number;
  poleChangePct: number;
  flagHighSlope: number;
  flagLowSlope: number;
  flagHighAtLastBar: number;
  flagLowAtLastBar: number;
  breakoutLevel: number;
  breakoutConfirmed: boolean;
  breakoutBarsAgo: number | null;
  confidence: number;
  target: number;
  stopLoss: number;
  strength: 1 | 2 | 3;
  lastPrice: number;
  direction: 'up' | 'down';
};

type FlagOpts = {
  poleMinMove?: number; // es. 0.10 = 10%
  poleMinBars?: number;
  poleMaxBars?: number;
  poleMaxPullback?: number; // retracement interno massimo (frazione)
  flagMinBars?: number;
  flagMaxBars?: number;
  flagMaxRetracement?: number; // frazione del pole che la flag può riprendere
  breakoutWindow?: number;
  minConfidence?: number;
};

const DEFAULT_FLAG: Required<FlagOpts> = {
  poleMinMove: 0.10,
  poleMinBars: 3,
  poleMaxBars: 8,
  poleMaxPullback: 0.30,
  flagMinBars: 5,
  flagMaxBars: 15,
  flagMaxRetracement: 0.50,
  breakoutWindow: 3,
  minConfidence: 0.7,
};

/**
 * Linear regression sui prezzi y con indici x.
 * Torna slope e intercept.
 */
function linreg(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    den += (x[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  // R²
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * x[i] + intercept;
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

/**
 * Detection Flag (bull e bear).
 */
export function detectFlags(
  candles: OHLCV[],
  userOpts: FlagOpts = {}
): FlagPattern[] {
  const opts = { ...DEFAULT_FLAG, ...userOpts };
  if (candles.length < opts.poleMaxBars + opts.flagMaxBars + 5) return [];

  const out: FlagPattern[] = [];
  const lastIdx = candles.length - 1;
  const lastPrice = candles[lastIdx].c;

  // Scorri all'indietro: per ogni possibile fine-flag, cerca un pole che la precede
  // Per efficienza, valuto solo flag che finiscono nelle ultime 30 candele
  const searchFrom = Math.max(opts.poleMaxBars + opts.flagMinBars, lastIdx - 30);

  for (let flagEnd = searchFrom; flagEnd <= lastIdx; flagEnd++) {
    for (let flagLen = opts.flagMinBars; flagLen <= opts.flagMaxBars; flagLen++) {
      const flagStart = flagEnd - flagLen + 1;
      if (flagStart < opts.poleMaxBars) continue;

      for (let poleLen = opts.poleMinBars; poleLen <= opts.poleMaxBars; poleLen++) {
        const poleStart = flagStart - poleLen;
        if (poleStart < 0) continue;
        const poleEnd = flagStart - 1;
        if (poleEnd < 0) continue;

        const pStart = candles[poleStart].c;
        const pEnd = candles[poleEnd].c;
        const move = (pEnd - pStart) / pStart;

        // Serve un movimento abbastanza grande
        if (Math.abs(move) < opts.poleMinMove) continue;
        const isBull = move > 0;

        // Pullback interno del pole
        let internalRetr = 0;
        if (isBull) {
          let maxSoFar = pStart;
          for (let i = poleStart; i <= poleEnd; i++) {
            const c = candles[i].c;
            if (c > maxSoFar) maxSoFar = c;
            const drawdown = (maxSoFar - candles[i].l) / (pEnd - pStart);
            if (drawdown > internalRetr) internalRetr = drawdown;
          }
        } else {
          let minSoFar = pStart;
          for (let i = poleStart; i <= poleEnd; i++) {
            const c = candles[i].c;
            if (c < minSoFar) minSoFar = c;
            const rally = (candles[i].h - minSoFar) / (pStart - pEnd);
            if (rally > internalRetr) internalRetr = rally;
          }
        }
        if (internalRetr > opts.poleMaxPullback) continue;

        // Flag: calcolo trendline su high e low
        const xs: number[] = [];
        const flagHighs: number[] = [];
        const flagLows: number[] = [];
        for (let i = flagStart; i <= flagEnd; i++) {
          xs.push(i);
          flagHighs.push(candles[i].h);
          flagLows.push(candles[i].l);
        }
        const regHigh = linreg(xs, flagHighs);
        const regLow = linreg(xs, flagLows);

        // Il canale della flag deve andare in direzione opposta al pole (o laterale)
        // Per bull flag: high slope ≤0 (o leggermente positiva), low slope ≤0
        // Per bear flag: opposto
        if (isBull && (regHigh.slope > 0.3 * (pEnd - pStart) / poleLen)) continue;
        if (!isBull && (regLow.slope < -0.3 * (pStart - pEnd) / poleLen)) continue;

        // Retracement della flag rispetto al pole
        let flagExtreme: number;
        if (isBull) {
          flagExtreme = Math.min(...flagLows);
          const flagRetr = (pEnd - flagExtreme) / (pEnd - pStart);
          if (flagRetr > opts.flagMaxRetracement || flagRetr < 0) continue;
        } else {
          flagExtreme = Math.max(...flagHighs);
          const flagRetr = (flagExtreme - pEnd) / (pStart - pEnd);
          if (flagRetr > opts.flagMaxRetracement || flagRetr < 0) continue;
        }

        // Qualità del fit: i prezzi devono seguire le trendline (R² alto)
        const fitQuality = (regHigh.r2 + regLow.r2) / 2;

        // Confidence: combinazione di movimento del pole, basso pullback, buon fit
        const moveStrength = Math.min(1, Math.abs(move) / 0.20);
        const pullbackQuality = 1 - internalRetr / opts.poleMaxPullback;
        const confidence = moveStrength * 0.3 + pullbackQuality * 0.3 + fitQuality * 0.4;
        if (confidence < opts.minConfidence) continue;

        // Breakout?
        const highAtLast = regHigh.slope * lastIdx + regHigh.intercept;
        const lowAtLast = regLow.slope * lastIdx + regLow.intercept;
        const breakoutLevel = isBull ? highAtLast : lowAtLast;

        let breakoutBarsAgo: number | null = null;
        const maxK = Math.min(opts.breakoutWindow, lastIdx - flagEnd);
        for (let k = 0; k <= maxK; k++) {
          const barIdx = lastIdx - k;
          if (barIdx <= flagEnd) break;
          const bar = candles[barIdx];
          const channelHigh = regHigh.slope * barIdx + regHigh.intercept;
          const channelLow = regLow.slope * barIdx + regLow.intercept;
          if (isBull && bar.c > channelHigh) {
            breakoutBarsAgo = k;
            break;
          }
          if (!isBull && bar.c < channelLow) {
            breakoutBarsAgo = k;
            break;
          }
        }

        let strength: 1 | 2 | 3 = 2;
        if (breakoutBarsAgo !== null && breakoutBarsAgo <= 2) strength = 3;

        // Target = entry + lunghezza del pole (nella direzione)
        const poleMagnitude = Math.abs(pEnd - pStart);
        const target = isBull
          ? breakoutLevel + poleMagnitude
          : breakoutLevel - poleMagnitude;
        const stopLoss = isBull ? flagExtreme * 0.995 : flagExtreme * 1.005;

        out.push({
          type: isBull ? 'BULL_FLAG' : 'BEAR_FLAG',
          startIdx: poleStart,
          poleEndIdx: poleEnd,
          endIdx: flagEnd,
          poleStartPrice: pStart,
          poleEndPrice: pEnd,
          poleChangePct: move * 100,
          flagHighSlope: regHigh.slope,
          flagLowSlope: regLow.slope,
          flagHighAtLastBar: highAtLast,
          flagLowAtLastBar: lowAtLast,
          breakoutLevel,
          breakoutConfirmed: breakoutBarsAgo !== null,
          breakoutBarsAgo,
          confidence,
          target,
          stopLoss,
          strength,
          lastPrice,
          direction: isBull ? 'up' : 'down',
        });

        // Prendo il primo match per questo poleStart, poi rompo i cicli interni
        break;
      }
    }
  }

  // Dedup: per lo stesso range mantengo solo il più confidente
  out.sort((a, b) => b.confidence - a.confidence);
  const deduped: FlagPattern[] = [];
  const used: Array<[number, number]> = [];
  for (const p of out) {
    const overlap = used.some(([s, e]) => p.startIdx < e && p.endIdx > s);
    if (!overlap) {
      deduped.push(p);
      used.push([p.startIdx, p.endIdx]);
    }
  }

  return deduped;
}
