/**
 * Indicatori tecnici in TypeScript puro.
 *
 * - WMA: Weighted Moving Average
 * - HMA: Hull Moving Average (WMA(2*WMA(n/2) - WMA(n), sqrt(n)))
 * - Heikin Ashi candles
 */

import type { OHLCV } from './yahoo';

/**
 * Weighted Moving Average.
 * Pesi lineari crescenti: il valore più recente ha peso n, il più vecchio peso 1.
 */
export function wma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) {
      sum += values[i - (period - 1 - k)] * (k + 1);
    }
    out[i] = sum / denom;
  }
  return out;
}

/**
 * Hull Moving Average.
 * HMA(n) = WMA( 2 * WMA(n/2) - WMA(n), sqrt(n) )
 */
export function hma(values: number[], period: number): (number | null)[] {
  const half = Math.floor(period / 2);
  const sqrtP = Math.floor(Math.sqrt(period));
  if (half < 1 || sqrtP < 1) return new Array(values.length).fill(null);

  const wmaHalf = wma(values, half);
  const wmaFull = wma(values, period);
  const diff: number[] = values.map((_, i) => {
    const a = wmaHalf[i];
    const b = wmaFull[i];
    if (a == null || b == null) return NaN;
    return 2 * a - b;
  });

  const valid: number[] = [];
  const validIdx: number[] = [];
  diff.forEach((v, i) => {
    if (!Number.isNaN(v)) {
      valid.push(v);
      validIdx.push(i);
    }
  });

  const wmaOnDiff = wma(valid, sqrtP);
  const out: (number | null)[] = new Array(values.length).fill(null);
  wmaOnDiff.forEach((v, i) => {
    if (v != null) out[validIdx[i]] = v;
  });
  return out;
}

/**
 * Heikin Ashi candles.
 * HA_Close = (O + H + L + C) / 4
 * HA_Open  = (prev HA_Open + prev HA_Close) / 2
 * HA_High  = max(H, HA_Open, HA_Close)
 * HA_Low   = min(L, HA_Open, HA_Close)
 */
export function heikinAshi(candles: OHLCV[]): OHLCV[] {
  if (candles.length === 0) return [];
  const out: OHLCV[] = [];
  let haOpenPrev = (candles[0].o + candles[0].c) / 2;
  let haClosePrev = (candles[0].o + candles[0].h + candles[0].l + candles[0].c) / 4;
  out.push({
    t: candles[0].t,
    o: haOpenPrev,
    h: Math.max(candles[0].h, haOpenPrev, haClosePrev),
    l: Math.min(candles[0].l, haOpenPrev, haClosePrev),
    c: haClosePrev,
    v: candles[0].v,
  });

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.o + c.h + c.l + c.c) / 4;
    const haOpen = (haOpenPrev + haClosePrev) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);
    out.push({ t: c.t, o: haOpen, h: haHigh, l: haLow, c: haClose, v: c.v });
    haOpenPrev = haOpen;
    haClosePrev = haClose;
  }
  return out;
}

/**
 * Una candela Heikin Ashi è "verde senza wick inferiore"
 * quando close >= open E low >= open (entro epsilon).
 */
export function isBullishHANoLowerWick(ha: OHLCV, epsilon = 1e-6): boolean {
  return ha.c >= ha.o && ha.l >= ha.o - epsilon;
}
