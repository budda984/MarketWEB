/**
 * Fair value gap sul giornaliero, legati a una rottura di struttura.
 *
 * GEOMETRIA
 * Tre candele consecutive. Se il minimo della terza sta sopra il massimo
 * della prima, fra i due resta una fascia che la candela centrale ha
 * attraversato senza scambi nelle vicine: FVG rialzista. Specularmente,
 * massimo della terza sotto il minimo della prima: ribassista.
 *
 * LA SOLA GEOMETRIA NON BASTA
 * Tre candele con un vuoto in mezzo capitano spesso, anche in una salita
 * tranquilla o dopo un picco qualsiasi. Il FVG che conta nasce da uno
 * strappo che rompe la struttura del mercato. Servono quindi anche:
 *
 *  1. STRAPPO: la candela centrale ha un corpo di almeno
 *     MIN_DISPLACEMENT_ATR volte l'ATR, nel verso del FVG.
 *
 *  2. ROTTURA DI STRUTTURA (BOS): entro BOS_WINDOW candele dopo la terza,
 *     una chiusura oltre l'ultimo massimo significativo (rialzista) o
 *     minimo significativo (ribassista). Il livello deve essere ancora
 *     integro prima dello strappo: se era gia' stato superato, la
 *     struttura era gia' rotta e il FVG non ne e' la causa.
 *
 *  Massimo significativo: il piu' alto fra PIVOT_LEN candele a sinistra e
 *  PIVOT_LEN a destra. Si considera noto solo dopo quelle candele a
 *  destra, e deve esserlo prima dello strappo: niente sguardi al futuro.
 *
 * ZONE CONTIGUE
 * Nello stesso strappo si formano spesso FVG su candele consecutive, con
 * fasce che si sovrappongono. Quelli successivi, entro due candele e
 * nella stessa direzione, si uniscono alla zona che ha rotto la struttura
 * anche senza una rottura propria: sono lo stesso vuoto.
 *
 * QUANDO SI CHIUDE
 * Al primo tocco: una candela successiva che entra nella fascia, anche
 * solo con l'ombra. Si restituiscono solo quelli ancora aperti.
 *
 * FILTRO SULLA DIMENSIONE
 * La fascia deve essere almeno MIN_SIZE_ATR volte l'ATR: soglia relativa
 * alla volatilita' del titolo, non una percentuale fissa.
 */

import type { OHLCV } from './yahoo';

export type FvgDirection = 'bullish' | 'bearish';

export type Fvg = {
  direction: FvgDirection;
  /** Candela centrale, secondi unix: la fascia parte da qui */
  time: number;
  /** Bordo inferiore e superiore della fascia */
  bottom: number;
  top: number;
  /** Ampiezza in percentuale del prezzo alla formazione */
  sizePct: number;
  /** Ampiezza in multipli di ATR */
  sizeAtr: number;
  /** Distanza dell'ultimo prezzo dal bordo del primo tocco, in percentuale */
  distancePct: number;
  /** Struttura rotta: livello, candela che lo ha fissato, candela che lo ha rotto */
  bos: { level: number; fromTime: number; toTime: number };
};

export const MIN_SIZE_ATR = 0.25;
export const MIN_DISPLACEMENT_ATR = 1.0;
export const PIVOT_LEN = 3;
export const BOS_WINDOW = 2;

const ATR_PERIOD = 14;

/** ATR semplice: media dei range veri delle ultime `period` candele */
function atrSeries(c: OHLCV[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  const tr: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const prevClose = i > 0 ? c[i - 1].c : c[i].c;
    tr.push(
      Math.max(
        c[i].h - c[i].l,
        Math.abs(c[i].h - prevClose),
        Math.abs(c[i].l - prevClose)
      )
    );
    if (i >= period) {
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += tr[k];
      out[i] = sum / period;
    }
  }
  return out;
}

/** Indici dei massimi (o minimi) significativi */
function pivots(c: OHLCV[], kind: 'high' | 'low', len = PIVOT_LEN): number[] {
  const out: number[] = [];
  for (let p = len; p < c.length - len; p++) {
    const v = kind === 'high' ? c[p].h : c[p].l;
    let ok = true;
    for (let k = p - len; k <= p + len && ok; k++) {
      if (k === p) continue;
      const w = kind === 'high' ? c[k].h : c[k].l;
      // A sinistra stretto, a destra basta non essere superato: due
      // massimi uguali consecutivi contano come uno
      if (kind === 'high' ? (k < p ? w >= v : w > v) : (k < p ? w <= v : w < v)) {
        ok = false;
      }
    }
    if (ok) out.push(p);
  }
  return out;
}

/**
 * Ultimo livello significativo noto e ancora integro alla candela
 * `before` (esclusa): per un rialzo, un massimo mai superato in chiusura.
 */
function lastIntactPivot(
  c: OHLCV[],
  piv: number[],
  kind: 'high' | 'low',
  before: number
): number | null {
  for (let k = piv.length - 1; k >= 0; k--) {
    const p = piv[k];
    // Noto solo dopo PIVOT_LEN candele a destra
    if (p + PIVOT_LEN >= before) continue;
    const level = kind === 'high' ? c[p].h : c[p].l;
    let broken = false;
    for (let j = p + 1; j < before; j++) {
      if (kind === 'high' ? c[j].c > level : c[j].c < level) {
        broken = true;
        break;
      }
    }
    // Il piu' recente e' gia' rotto: la struttura e' gia' stata superata,
    // non c'e' un livello da rompere
    return broken ? null : p;
  }
  return null;
}

type Zone = {
  direction: FvgDirection;
  time: number;
  lastIdx: number;
  bottom: number;
  top: number;
  refPrice: number;
  atr: number;
  bos: { level: number; fromTime: number; toTime: number };
};

/**
 * FVG ancora aperti alla fine della serie, dal piu' recente.
 */
export function detectOpenFvgs(
  candles: OHLCV[],
  opts: {
    minSizeAtr?: number;
    minDisplacementAtr?: number;
  } = {}
): Fvg[] {
  const minSizeAtr = opts.minSizeAtr ?? MIN_SIZE_ATR;
  const minDispAtr = opts.minDisplacementAtr ?? MIN_DISPLACEMENT_ATR;
  const n = candles.length;
  if (n < ATR_PERIOD + 3) return [];

  const atr = atrSeries(candles);
  const highs = pivots(candles, 'high');
  const lows = pivots(candles, 'low');
  const zones: Zone[] = [];

  for (let i = 2; i < n; i++) {
    const first = candles[i - 2];
    const mid = candles[i - 1];
    const third = candles[i];
    // ATR prima dello strappo, per non farlo gonfiare dalla candela stessa
    const a = atr[i - 2];
    if (a == null || a <= 0) continue;

    let direction: FvgDirection | null = null;
    let bottom = 0;
    let top = 0;
    if (third.l > first.h) {
      direction = 'bullish';
      bottom = first.h;
      top = third.l;
    } else if (third.h < first.l) {
      direction = 'bearish';
      bottom = third.h;
      top = first.l;
    }
    if (!direction) continue;
    const bull = direction === 'bullish';
    if (top - bottom < minSizeAtr * a) continue;

    // Chiuso al primo tocco dopo la terza candela
    let touched = false;
    for (let j = i + 1; j < n; j++) {
      if (bull ? candles[j].l <= top : candles[j].h >= bottom) {
        touched = true;
        break;
      }
    }
    if (touched) continue;

    // Continuazione dello stesso strappo: si unisce alla zona precedente
    const prev = zones[zones.length - 1];
    const tol = 0.1 * a;
    if (
      prev &&
      prev.direction === direction &&
      i - prev.lastIdx <= 2 &&
      bottom <= prev.top + tol &&
      top >= prev.bottom - tol
    ) {
      prev.bottom = Math.min(prev.bottom, bottom);
      prev.top = Math.max(prev.top, top);
      prev.lastIdx = i;
      continue;
    }

    // 1. Strappo: corpo ampio nel verso del FVG
    const body = mid.c - mid.o;
    if ((bull ? body : -body) < minDispAtr * a) continue;

    // 2. Rottura di struttura
    const piv = lastIntactPivot(candles, bull ? highs : lows, bull ? 'high' : 'low', i - 1);
    if (piv == null) continue;
    const level = bull ? candles[piv].h : candles[piv].l;
    let breakIdx: number | null = null;
    for (let j = i - 1; j <= Math.min(i + BOS_WINDOW, n - 1); j++) {
      if (bull ? candles[j].c > level : candles[j].c < level) {
        breakIdx = j;
        break;
      }
    }
    if (breakIdx == null) continue;

    zones.push({
      direction,
      time: mid.t,
      lastIdx: i,
      bottom,
      top,
      refPrice: mid.c,
      atr: a,
      bos: { level, fromTime: candles[piv].t, toTime: candles[breakIdx].t },
    });
  }

  const last = candles[n - 1].c;
  return zones
    .map((z) => {
      const edge = z.direction === 'bullish' ? z.top : z.bottom;
      const size = z.top - z.bottom;
      return {
        direction: z.direction,
        time: z.time,
        bottom: z.bottom,
        top: z.top,
        sizePct: (size / z.refPrice) * 100,
        sizeAtr: size / z.atr,
        distancePct: ((last - edge) / last) * 100,
        bos: z.bos,
      };
    })
    .reverse();
}
