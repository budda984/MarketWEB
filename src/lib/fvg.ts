/**
 * Fair value gap sul giornaliero.
 *
 * DEFINIZIONE
 * Tre candele consecutive. Se il minimo della terza sta sopra il massimo
 * della prima, fra i due resta una fascia di prezzo in cui la candela
 * centrale e' passata senza che le vicine la toccassero: un FVG
 * rialzista. Specularmente, massimo della terza sotto il minimo della
 * prima: ribassista.
 *
 * QUANDO SI CHIUDE
 * Al primo tocco: basta che una candela successiva entri nella fascia,
 * anche solo con l'ombra. Per un FVG rialzista, un minimo che scende fino
 * al bordo superiore; per uno ribassista, un massimo che sale fino al
 * bordo inferiore. Si mostrano solo quelli ancora aperti.
 *
 * ZONE CONTIGUE
 * In un movimento forte si formano FVG su candele consecutive, con fasce
 * che si sovrappongono: sono lo stesso vuoto visto due volte. Quelli
 * nella stessa direzione che si toccano diventano una zona sola, con la
 * data del primo.
 *
 * FILTRO SULLA DIMENSIONE
 * Senza filtro compaiono fasce di pochi centesimi, irrilevanti. La soglia
 * e' relativa alla volatilita' del titolo (ATR a 14 sedute) invece che
 * fissa in percentuale: 1% e' tanto per un'utility e niente per un
 * titolo biotech.
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
  /** Distanza dell'ultimo prezzo dal bordo piu' vicino, in percentuale */
  distancePct: number;
};

/** Frazione di ATR sotto la quale un FVG non si considera */
export const MIN_SIZE_ATR = 0.25;

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

/**
 * FVG ancora aperti alla fine della serie, dal piu' recente.
 */
export function detectOpenFvgs(
  candles: OHLCV[],
  minSizeAtr = MIN_SIZE_ATR
): Fvg[] {
  if (candles.length < ATR_PERIOD + 3) return [];
  const atr = atrSeries(candles);
  const last = candles[candles.length - 1].c;
  // Zone in costruzione, in ordine cronologico
  const open: Array<{
    direction: FvgDirection;
    time: number;
    bottom: number;
    top: number;
    refPrice: number;
    atr: number;
  }> = [];

  for (let i = 2; i < candles.length; i++) {
    const first = candles[i - 2];
    const mid = candles[i - 1];
    const third = candles[i];
    // L'ATR si misura prima della formazione, per non farlo gonfiare
    // dalla stessa candela che crea il vuoto
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

    const size = top - bottom;
    if (size < minSizeAtr * a) continue;

    // Primo tocco dopo la terza candela: da li' in poi e' chiuso
    let touched = false;
    for (let j = i + 1; j < candles.length; j++) {
      if (direction === 'bullish' ? candles[j].l <= top : candles[j].h >= bottom) {
        touched = true;
        break;
      }
    }
    if (touched) continue;

    // Unione con la zona precedente, se stessa direzione e sovrapposta o
    // separata da uno scarto trascurabile (un decimo di ATR)
    const prev = open[open.length - 1];
    const tol = 0.1 * a;
    if (
      prev &&
      prev.direction === direction &&
      bottom <= prev.top + tol &&
      top >= prev.bottom - tol
    ) {
      prev.bottom = Math.min(prev.bottom, bottom);
      prev.top = Math.max(prev.top, top);
      prev.atr = Math.max(prev.atr, a);
      continue;
    }

    open.push({ direction, time: mid.t, bottom, top, refPrice: mid.c, atr: a });
  }

  return open
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
      };
    })
    .reverse();
}
