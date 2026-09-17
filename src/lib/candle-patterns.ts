/**
 * Pattern a candele di inversione e di indecisione.
 *
 * Qui si rilevano soltanto: nessun filtro di contesto, nessun giudizio
 * su quali valgano. Serve prima vedere quanti ne escono e come si
 * comportano, e su quello decidere cosa tenere.
 *
 * Le soglie sono relative alla volatilita' del titolo (ATR a 14 sedute)
 * e non in percentuale fissa: un corpo dell'1% e' enorme per un'utility
 * e trascurabile per un titolo volatile.
 *
 * Una nota sulla direzione. Un engulfing rialzista dopo una salita non
 * e' un'inversione, e' continuazione: per questo ogni pattern porta con
 * se' il contesto in cui e' comparso (la posizione rispetto alle venti
 * sedute precedenti), senza pero' scartare nulla.
 */

import type { OHLCV } from './yahoo';

export type CandlePatternKind =
  | 'engulfing'
  | 'outside'
  | 'harami'
  | 'inside'
  | 'hammer'
  | 'shooting_star'
  | 'pin_bar'
  | 'doji'
  | 'marubozu';

export type CandlePattern = {
  kind: CandlePatternKind;
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Candela che completa il pattern, secondi unix */
  time: number;
  /** Indice nella serie ricevuta */
  index: number;
  /** Ampiezza del range della candela in multipli di ATR */
  sizeAtr: number;
  /** Volume rispetto alla media a 20 sedute; null se il volume manca */
  volumeRatio: number | null;
  /**
   * Dove si trova la candela nell'intervallo delle ultime venti sedute:
   * 0 sul minimo, 100 sul massimo. Serve a distinguere un'inversione da
   * una continuazione.
   */
  positionPct: number | null;
};

export const PATTERN_LABELS: Record<CandlePatternKind, string> = {
  engulfing: 'Engulfing',
  outside: 'Outside',
  harami: 'Harami',
  inside: 'Inside',
  hammer: 'Martello',
  shooting_star: 'Stella cadente',
  pin_bar: 'Pin bar',
  doji: 'Doji',
  marubozu: 'Marubozu',
};

/** Sigle brevi per i marcatori sul grafico, dove lo spazio e' poco */
export const PATTERN_ABBR: Record<CandlePatternKind, string> = {
  engulfing: 'ENG',
  outside: 'OUT',
  harami: 'HAR',
  inside: 'INS',
  hammer: 'MAR',
  shooting_star: 'STC',
  pin_bar: 'PIN',
  doji: 'DOJ',
  marubozu: 'MRB',
};

const ATR_PERIOD = 14;
const CONTEXT_BARS = 20;

function atrAt(c: OHLCV[], i: number, period = ATR_PERIOD): number | null {
  if (i < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const prevClose = c[k - 1].c;
    sum += Math.max(
      c[k].h - c[k].l,
      Math.abs(c[k].h - prevClose),
      Math.abs(c[k].l - prevClose)
    );
  }
  return sum / period;
}

function body(c: OHLCV): number {
  return Math.abs(c.c - c.o);
}

function range(c: OHLCV): number {
  return c.h - c.l;
}

function upperWick(c: OHLCV): number {
  return c.h - Math.max(c.o, c.c);
}

function lowerWick(c: OHLCV): number {
  return Math.min(c.o, c.c) - c.l;
}

/** Posizione della chiusura nell'intervallo delle ultime venti sedute */
function positionPct(c: OHLCV[], i: number): number | null {
  if (i < CONTEXT_BARS) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i - CONTEXT_BARS; k < i; k++) {
    hi = Math.max(hi, c[k].h);
    lo = Math.min(lo, c[k].l);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return null;
  return ((c[i].c - lo) / (hi - lo)) * 100;
}

function volumeRatio(c: OHLCV[], i: number): number | null {
  if (i < 20) return null;
  let sum = 0;
  let n = 0;
  for (let k = i - 20; k < i; k++) {
    if (c[k].v > 0) {
      sum += c[k].v;
      n++;
    }
  }
  if (n < 10 || sum === 0 || !(c[i].v > 0)) return null;
  return c[i].v / (sum / n);
}

/**
 * Tutti i pattern trovati nella serie, in ordine cronologico.
 *
 * Una candela puo' generare piu' pattern: un outside con corpo che
 * ingloba il precedente e' insieme outside ed engulfing, e sono
 * davvero due osservazioni diverse sulla stessa candela.
 */
export function detectCandlePatterns(candles: OHLCV[]): CandlePattern[] {
  const out: CandlePattern[] = [];
  if (candles.length < ATR_PERIOD + 2) return out;

  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    const atr = atrAt(candles, i);
    if (atr == null || atr <= 0) continue;

    const rb = range(b);
    const bb = body(b);
    const ba = body(a);
    if (rb <= 0) continue;

    const common = {
      time: b.t,
      index: i,
      sizeAtr: rb / atr,
      volumeRatio: volumeRatio(candles, i),
      positionPct: positionPct(candles, i),
    };

    const bullish = b.c > b.o;
    const bearish = b.c < b.o;

    // --- Due candele ---------------------------------------------------

    // Engulfing: il corpo attuale contiene quello precedente e va nel
    // verso opposto. Si esclude il caso in cui il corpo precedente sia
    // quasi nullo, perche' inglobare un doji non significa niente.
    if (
      ba > 0.1 * atr &&
      Math.max(b.o, b.c) >= Math.max(a.o, a.c) &&
      Math.min(b.o, b.c) <= Math.min(a.o, a.c) &&
      bb > ba
    ) {
      if (bullish && a.c < a.o) {
        out.push({ ...common, kind: 'engulfing', direction: 'bullish' });
      } else if (bearish && a.c > a.o) {
        out.push({ ...common, kind: 'engulfing', direction: 'bearish' });
      }
    }

    // Outside: l'intero intervallo, ombre comprese, contiene quello
    // precedente. La direzione la da' la chiusura.
    if (b.h > a.h && b.l < a.l) {
      out.push({
        ...common,
        kind: 'outside',
        direction: bullish ? 'bullish' : bearish ? 'bearish' : 'neutral',
      });
    }

    // Inside: l'opposto, tutto dentro la precedente. Non e' inversione
    // ma compressione: spesso precede un movimento.
    if (b.h <= a.h && b.l >= a.l) {
      out.push({ ...common, kind: 'inside', direction: 'neutral' });
    }

    // Harami: corpo piccolo dentro un corpo precedente ampio, di verso
    // opposto. Diverso dall'inside, che guarda le ombre.
    if (
      ba > 0.6 * atr &&
      bb < ba * 0.6 &&
      Math.max(b.o, b.c) <= Math.max(a.o, a.c) &&
      Math.min(b.o, b.c) >= Math.min(a.o, a.c)
    ) {
      if (a.c < a.o && bullish) {
        out.push({ ...common, kind: 'harami', direction: 'bullish' });
      } else if (a.c > a.o && bearish) {
        out.push({ ...common, kind: 'harami', direction: 'bearish' });
      }
    }

    // --- Una candela sola ----------------------------------------------

    const up = upperWick(b);
    const low = lowerWick(b);

    // Martello: corpo piccolo in alto, ombra inferiore lunga. Il prezzo
    // e' sceso durante la seduta ed e' stato ricomprato.
    if (bb < rb * 0.35 && low > rb * 0.55 && up < rb * 0.2) {
      out.push({ ...common, kind: 'hammer', direction: 'bullish' });
    }

    // Stella cadente: lo specchio del martello
    if (bb < rb * 0.35 && up > rb * 0.55 && low < rb * 0.2) {
      out.push({ ...common, kind: 'shooting_star', direction: 'bearish' });
    }

    // Pin bar: un'ombra domina la candela e sporge oltre le due vicine.
    // Piu' selettiva del martello perche' chiede anche il rifiuto di un
    // livello, non solo la forma.
    if (i + 1 < candles.length) {
      const prev = candles[i - 1];
      if (low > rb * 0.6 && b.l < prev.l && bb < rb * 0.3) {
        out.push({ ...common, kind: 'pin_bar', direction: 'bullish' });
      } else if (up > rb * 0.6 && b.h > prev.h && bb < rb * 0.3) {
        out.push({ ...common, kind: 'pin_bar', direction: 'bearish' });
      }
    }

    // Doji: apertura e chiusura quasi coincidenti. Indecisione, e la
    // candela deve avere un'escursione vera, altrimenti e' solo una
    // seduta piatta.
    if (bb < rb * 0.08 && rb > 0.5 * atr) {
      out.push({ ...common, kind: 'doji', direction: 'neutral' });
    }

    // Marubozu: quasi tutto corpo, ombre trascurabili. Una seduta a
    // senso unico dall'apertura alla chiusura.
    if (bb > rb * 0.9 && rb > 0.8 * atr) {
      out.push({
        ...common,
        kind: 'marubozu',
        direction: bullish ? 'bullish' : 'bearish',
      });
    }
  }

  return out;
}

/** Solo i pattern delle ultime `bars` candele, dal piu' recente */
export function recentCandlePatterns(
  candles: OHLCV[],
  bars = 5
): CandlePattern[] {
  const all = detectCandlePatterns(candles);
  const cutoff = candles.length - bars;
  return all.filter((p) => p.index >= cutoff).reverse();
}
