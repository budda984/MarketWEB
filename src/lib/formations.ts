/**
 * Figure grafiche colte MENTRE si formano.
 *
 * DIFFERENZA RISPETTO AL RILEVAMENTO CLASSICO
 * Cercare la figura completa richiede che tutti i minimi siano gia'
 * confermati, e un minimo si conferma solo diverse sedute dopo: quando
 * il segnale arriva, il movimento e' in buona parte avvenuto. Qui
 * servono due soli pivot confermati, e il terzo punto e' il prezzo di
 * oggi — che non ha bisogno di conferma perche' e' sotto gli occhi.
 *
 * IL PREZZO DA PAGARE
 * Molte figure in formazione non si completeranno: il prezzo tornera' a
 * scendere e quella che sembrava una spalla destra restera' un rimbalzo.
 * E' inevitabile, ed e' il costo del vederle presto anziche' tardi. Per
 * questo lo stato e' sempre esplicito.
 */

import type { OHLCV } from './yahoo';
import { findPivots, type Pivot } from './patterns';

export type FormationKind =
  | 'IHS'
  | 'DOUBLE_BOTTOM'
  | 'TRIPLE_BOTTOM'
  | 'HS'
  | 'DOUBLE_TOP'
  | 'TRIPLE_TOP'
  | 'FALLING_WEDGE'
  | 'RISING_WEDGE'
  | 'BULL_FLAG'
  | 'BEAR_FLAG';
export type FormationDirection = 'bullish' | 'bearish';
export type FormationState = 'forming' | 'right_shoulder' | 'confirmed';

export const FORMATION_LABELS: Record<FormationKind, string> = {
  IHS: 'Testa e spalle rovesciato',
  DOUBLE_BOTTOM: 'Doppio minimo',
  TRIPLE_BOTTOM: 'Triplo minimo',
  HS: 'Testa e spalle',
  DOUBLE_TOP: 'Doppio massimo',
  TRIPLE_TOP: 'Triplo massimo',
  FALLING_WEDGE: 'Cuneo discendente',
  RISING_WEDGE: 'Cuneo ascendente',
  BULL_FLAG: 'Bandiera rialzista',
  BEAR_FLAG: 'Bandiera ribassista',
};

export const FORMATION_DIRECTION: Record<FormationKind, FormationDirection> = {
  IHS: 'bullish',
  DOUBLE_BOTTOM: 'bullish',
  TRIPLE_BOTTOM: 'bullish',
  HS: 'bearish',
  DOUBLE_TOP: 'bearish',
  TRIPLE_TOP: 'bearish',
  FALLING_WEDGE: 'bullish',
  RISING_WEDGE: 'bearish',
  BULL_FLAG: 'bullish',
  BEAR_FLAG: 'bearish',
};

/**
 * Doppi e tripli massimi o minimi: figure fatte di tocchi ripetuti sullo
 * stesso livello. Non hanno linea del collo, e si completano quando il
 * tocco finale e' formato, non quando il prezzo rompe qualcosa.
 */
export function isMultiTouch(kind: FormationKind): boolean {
  return (
    kind === 'DOUBLE_TOP' ||
    kind === 'DOUBLE_BOTTOM' ||
    kind === 'TRIPLE_TOP' ||
    kind === 'TRIPLE_BOTTOM'
  );
}

/**
 * Come chiamare il livello di riferimento della figura. Nei doppi e
 * tripli e' il livello dei tocchi, cioe' la resistenza o il supporto
 * che sta reggendo: chiamarlo collo sarebbe sbagliato.
 */
export function levelLabel(kind: FormationKind): string {
  if (kind === 'DOUBLE_TOP' || kind === 'TRIPLE_TOP') return 'resistenza';
  if (kind === 'DOUBLE_BOTTOM' || kind === 'TRIPLE_BOTTOM') return 'supporto';
  return 'collo';
}

/**
 * Le etichette cambiano con la figura: parlare di "spalla destra" per un
 * doppio minimo non ha senso.
 */
export function stateLabel(kind: FormationKind, state: FormationState): string {
  if (isMultiTouch(kind)) {
    const triple = kind === 'TRIPLE_TOP' || kind === 'TRIPLE_BOTTOM';
    const point =
      kind === 'DOUBLE_TOP' || kind === 'TRIPLE_TOP' ? 'massimo' : 'minimo';
    if (state === 'forming') return `${triple ? 'Terzo' : 'Secondo'} ${point} in corso`;
    return `${triple ? 'Terzo' : 'Secondo'} ${point} formato`;
  }
  if (state === 'confirmed') return 'Linea del collo rotta';
  if (state === 'forming') return 'In formazione';
  if (kind === 'FALLING_WEDGE' || kind === 'RISING_WEDGE')
    return 'Cuneo in compressione';
  if (kind === 'BULL_FLAG' || kind === 'BEAR_FLAG')
    return 'Consolidamento maturo';
  return 'Spalla destra completata';
}

export const STATE_LABELS: Record<FormationState, string> = {
  forming: 'In formazione',
  right_shoulder: 'Struttura completata',
  confirmed: 'Linea del collo rotta',
};

export type FormationPoint = {
  /** Timestamp unix, per il disegno sul grafico */
  time: number;
  price: number;
  label: string;
};

export type Formation = {
  ticker: string;
  kind: FormationKind;
  direction: FormationDirection;
  state: FormationState;
  points: FormationPoint[];
  /** Livello di conferma: rottura al rialzo = figura completata */
  neckline: number;
  /** Estremi della linea del collo, per tracciarla */
  necklineFrom: { time: number; price: number };
  necklineTo: { time: number; price: number };
  price: number;
  /** Quanto manca al livello di conferma, in percentuale */
  distanceToNecklinePct: number;
  /** Profondita' della figura rispetto alla linea del collo */
  depthPct: number;
  /** Obiettivo teorico: altezza della figura proiettata oltre il collo */
  target: number;
  /** Sedute trascorse dall'inizio della figura */
  barsSpan: number;
  lastDate: string;
  /** Rette convergenti, presenti solo nelle figure a cuneo */
  upperLine?: { from: FormationPoint; to: FormationPoint };
  lowerLine?: { from: FormationPoint; to: FormationPoint };
  /** Quanto si e' ristretto il cuneo, in percentuale */
  convergencePct?: number;
};

type Opts = {
  leftBars: number;
  rightBars: number;
  /** Tolleranza sull'allineamento fra spalle, o fra i due minimi */
  levelTolerance: number;
  /** Quanto la testa deve essere piu' profonda delle spalle */
  headDepthMin: number;
  /** Ampiezza minima della figura rispetto al prezzo */
  minDepthPct: number;
  durationMin: number;
  durationMax: number;
  /** Quanto il prezzo puo' distare dal livello della spalla per dire
   *  che ci e' tornato */
  returnTolerance: number;
};

const DEFAULTS: Opts = {
  leftBars: 6,
  rightBars: 6,
  levelTolerance: 0.02,
  headDepthMin: 0.06,
  minDepthPct: 7,
  durationMin: 25,
  durationMax: 120,
  returnTolerance: 0.03,
};

/** Massima inclinazione ammessa per la linea del collo. */
const NECKLINE_SLOPE_MAX = 0.05;
/** Massima asimmetria temporale fra i due lati della figura. */
const TIME_ASYMMETRY_MAX = 0.6;
/** Discesa minima che deve precedere la figura: e' un'inversione. */
const PRIOR_DECLINE_MIN = 0.06;
/** Risalita minima da un minimo perche' sia strutturale e non un ritracciamento. */
const PIVOT_PROMINENCE_MIN = 0.04;
/** Sedute minime fra la testa e oggi perche' una spalla destra sia plausibile. */
const MIN_BARS_SINCE_HEAD = 12;
/** Sedute minime fra i due estremi di un doppio massimo o minimo. */
const MIN_BARS_BETWEEN_EXTREMES = 12;
/** Quanto il prezzo deve essersi gia' allontanato dall'abbozzo di spalla. */
const ROLLOVER_MIN = 0.015;

function isoDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** Massimo delle chiusure fra due indici: serve per la linea del collo. */
function maxBetween(
  candles: OHLCV[],
  from: number,
  to: number
): { idx: number; price: number } {
  let best = { idx: from, price: -Infinity };
  for (let i = from; i <= to && i < candles.length; i++) {
    if (candles[i].h > best.price) best = { idx: i, price: candles[i].h };
  }
  return best;
}

/**
 * Un minimo e' strutturale solo se il prezzo poi risale in modo
 * apprezzabile: altrimenti e' una pausa dentro un movimento, non un
 * punto di inversione. E' il controllo che mancava, ed e' il motivo per
 * cui comparivano spalle pescate in mezzo a un rialzo.
 */
function prominence(candles: OHLCV[], lowIdx: number, window: number): number {
  const to = Math.min(candles.length - 1, lowIdx + window);
  let maxAfter = -Infinity;
  for (let i = lowIdx; i <= to; i++) {
    if (candles[i].h > maxAfter) maxAfter = candles[i].h;
  }
  const low = candles[lowIdx].l;
  if (!Number.isFinite(maxAfter) || low <= 0) return 0;
  return (maxAfter - low) / low;
}

/**
 * Una figura di inversione richiede che prima ci fosse una discesa.
 * Senza questo vincolo qualunque oscillazione dentro un rialzo puo'
 * assomigliare a un testa e spalle rovesciato.
 */
function hasPriorDecline(
  candles: OHLCV[],
  idx: number,
  lookback: number,
  minDrop: number
): boolean {
  const from = idx - lookback;
  if (from < 0) return false;
  const start = candles[from].c;
  const end = candles[idx].l;
  if (start <= 0) return false;
  return (start - end) / start >= minDrop;
}

/**
 * Speculare di prominence: un massimo e' strutturale solo se il prezzo
 * poi scende in modo apprezzabile.
 */
function prominenceHigh(
  candles: OHLCV[],
  highIdx: number,
  window: number
): number {
  const to = Math.min(candles.length - 1, highIdx + window);
  let minAfter = Infinity;
  for (let i = highIdx; i <= to; i++) {
    if (candles[i].l < minAfter) minAfter = candles[i].l;
  }
  const high = candles[highIdx].h;
  if (!Number.isFinite(minAfter) || high <= 0) return 0;
  return (high - minAfter) / high;
}

/** Una figura ribassista di inversione richiede una salita che la preceda. */
function hasPriorRise(
  candles: OHLCV[],
  idx: number,
  lookback: number,
  minRise: number
): boolean {
  const from = idx - lookback;
  if (from < 0) return false;
  const start = candles[from].c;
  const end = candles[idx].h;
  if (start <= 0) return false;
  return (end - start) / start >= minRise;
}

/** Punto piu' alto in un intervallo: e' il secondo massimo reale. */
function peakOnly(
  candles: OHLCV[],
  from: number,
  to: number
): { idx: number; price: number } | null {
  if (to - from < 2) return null;
  let best = { idx: -1, price: -Infinity };
  for (let i = from + 1; i <= to; i++) {
    if (candles[i].h > best.price) best = { idx: i, price: candles[i].h };
  }
  return best.idx >= 0 ? best : null;
}

/** Minimo delle chiusure in un intervallo, escludendo gli estremi. */
function valleyBetween(
  candles: OHLCV[],
  from: number,
  to: number
): { idx: number; price: number } | null {
  if (to - from < 3) return null;
  let best = { idx: -1, price: Infinity };
  for (let i = from + 1; i < to; i++) {
    if (candles[i].l < best.price) best = { idx: i, price: candles[i].l };
  }
  return best.idx >= 0 ? best : null;
}

/** Punto piu' basso in un intervallo: e' il secondo minimo reale. */
function troughBetween(
  candles: OHLCV[],
  from: number,
  to: number
): { idx: number; price: number } | null {
  if (to - from < 2) return null;
  let best = { idx: -1, price: Infinity };
  for (let i = from + 1; i <= to; i++) {
    if (candles[i].l < best.price) best = { idx: i, price: candles[i].l };
  }
  return best.idx >= 0 ? best : null;
}

/** Massimo delle chiusure in un intervallo, escludendo gli estremi. */
function peakBetween(
  candles: OHLCV[],
  from: number,
  to: number
): { idx: number; price: number } | null {
  if (to - from < 3) return null;
  let best = { idx: -1, price: -Infinity };
  for (let i = from + 1; i < to; i++) {
    if (candles[i].h > best.price) best = { idx: i, price: candles[i].h };
  }
  return best.idx >= 0 ? best : null;
}

/**
 * Retta di regressione sui punti dati, con R² per misurare quanto bene
 * li descrive: senza questo controllo qualunque insieme di pivot
 * produrrebbe due rette, anche in assenza di una struttura.
 */
function linreg(
  xs: number[],
  ys: number[]
): { slope: number; intercept: number; r2: number; at: (x: number) => number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, at: (x: number) => slope * x + intercept };
}

/**
 * Raccoglie i tocchi consecutivi su uno stesso livello, andando a
 * ritroso dall'ultimo: sono i due o tre minimi (o massimi) che formano
 * la figura, con gli estremi opposti che li separano.
 *
 * Il tocco piu' recente e' il punto reale piu' basso (o piu' alto) del
 * tratto finale, non l'ultimo pivot confermato: se il prezzo e' poi
 * sceso oltre, il livello ha ceduto e la figura non c'e' piu'.
 */
function collectTouches(
  candles: OHLCV[],
  pivots: Pivot[],
  lastIdx: number,
  o: Opts,
  side: 'low' | 'high'
): { points: Pivot[]; between: Array<{ idx: number; price: number }> } | null {
  const isLow = side === 'low';

  // Il tocco finale: estremo reale dopo l'ultimo pivot opposto
  const lastPivot = pivots.filter((p) => p.idx <= lastIdx).pop();
  if (!lastPivot) return null;

  const extreme = isLow
    ? troughBetween(candles, Math.max(0, lastPivot.idx - 1), lastIdx)
    : peakOnly(candles, Math.max(0, lastPivot.idx - 1), lastIdx);
  if (!extreme) return null;

  const level = extreme.price;
  const touches: Pivot[] = [{ ...lastPivot, idx: extreme.idx, price: extreme.price }];
  const between: Array<{ idx: number; price: number }> = [];

  // A ritroso: ogni tocco precedente deve stare sullo stesso livello,
  // essere abbastanza distante nel tempo e avere in mezzo un rimbalzo
  for (let i = pivots.length - 1; i >= 0 && touches.length < 3; i--) {
    const cand = pivots[i];
    const next = touches[touches.length - 1];
    if (cand.idx >= next.idx - MIN_BARS_BETWEEN_EXTREMES) continue;

    if (Math.abs(cand.price - level) / level > o.levelTolerance) continue;

    const mid = isLow
      ? peakBetween(candles, cand.idx, next.idx)
      : valleyBetween(candles, cand.idx, next.idx);
    if (!mid) continue;

    // Il rimbalzo intermedio deve essere reale, altrimenti i due tocchi
    // sono lo stesso movimento visto due volte
    const swing = isLow
      ? (mid.price - level) / level
      : (level - mid.price) / level;
    if (swing < PIVOT_PROMINENCE_MIN) continue;

    touches.push(cand);
    between.push(mid);
  }

  if (touches.length < 2) return null;

  // Il piu' vecchio dei tocchi deve avere alle spalle il movimento che
  // la figura dovrebbe invertire
  const first = touches[touches.length - 1];
  const span = lastIdx - first.idx;
  if (span < o.durationMin || span > o.durationMax) return null;

  const prominenceOk = isLow
    ? prominence(candles, first.idx, 25) >= PIVOT_PROMINENCE_MIN
    : prominenceHigh(candles, first.idx, 25) >= PIVOT_PROMINENCE_MIN;
  if (!prominenceOk) return null;

  const priorOk = isLow
    ? hasPriorDecline(candles, first.idx, 30, PRIOR_DECLINE_MIN)
    : hasPriorRise(candles, first.idx, 30, PRIOR_DECLINE_MIN);
  if (!priorOk) return null;

  // Raccolti a ritroso: si riporta tutto in ordine cronologico
  return { points: touches.reverse(), between: between.reverse() };
}

export function detectFormations(
  ticker: string,
  candles: OHLCV[],
  userOpts: Partial<Opts> = {}
): Formation[] {
  const o = { ...DEFAULTS, ...userOpts };
  if (candles.length < 60) return [];

  const lastIdx = candles.length - 1;
  const price = candles[lastIdx].c;
  if (!price || price <= 0) return [];

  const pivots = findPivots(candles, o.leftBars, o.rightBars);
  const lows = pivots.filter((p) => p.type === 'low');
  const highs = pivots.filter((p) => p.type === 'high');
  if (lows.length < 2 && highs.length < 2) return [];

  const out: Formation[] = [];

  // ------------------------------------------------------------------
  // TESTA E SPALLE ROVESCIATO
  //
  // Sequenza richiesta: discesa, spalla sinistra, risalita al primo
  // picco, discesa piu' profonda (testa), risalita al secondo picco,
  // spalla destra all'altezza della sinistra. La linea del collo unisce
  // i DUE PICCHI INTERMEDI, non il massimo assoluto del periodo.
  // ------------------------------------------------------------------
  for (let i = lows.length - 1; i >= 1; i--) {
    const head = lows[i];
    const ls = lows[i - 1];

    // La testa deve essere nettamente piu' profonda della spalla
    if (head.price >= ls.price * (1 - o.headDepthMin)) continue;

    const span = lastIdx - ls.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    // Entrambi i minimi devono essere strutturali: il prezzo deve essere
    // risalito in modo apprezzabile dopo ciascuno
    if (prominence(candles, ls.idx, 25) < PIVOT_PROMINENCE_MIN) continue;
    if (prominence(candles, head.idx, 25) < PIVOT_PROMINENCE_MIN) continue;

    // Prima della spalla sinistra ci deve essere stata una discesa:
    // e' una figura di inversione, non un'oscillazione dentro un rialzo
    if (!hasPriorDecline(candles, ls.idx, 30, PRIOR_DECLINE_MIN)) continue;

    // I due picchi intermedi definiscono il collo
    const peak1 = peakBetween(candles, ls.idx, head.idx);
    if (!peak1) continue;
    const peak2 = peakBetween(candles, head.idx, lastIdx);
    if (!peak2) continue;

    // Il collo deve essere all'incirca orizzontale: due picchi molto
    // sfalsati non formano una figura leggibile
    const slope =
      Math.abs(peak2.price - peak1.price) / Math.max(peak1.price, peak2.price);
    if (slope > NECKLINE_SLOPE_MAX) continue;

    const neckline = (peak1.price + peak2.price) / 2;
    if (!Number.isFinite(neckline) || neckline <= 0) continue;

    // Entrambe le spalle devono stare sotto il collo e sopra la testa
    if (ls.price >= neckline || head.price >= neckline) continue;

    const depthPct = ((neckline - head.price) / neckline) * 100;
    if (depthPct < o.minDepthPct) continue;

    // Le due spalle devono stare sullo stesso livello, non solo essere
    // entrambe sopra la testa
    // Eventuale spalla destra gia' formata
    const rsCandidates = lows.filter(
      (p) =>
        p.idx > peak1.idx &&
        p.idx > head.idx &&
        Math.abs(p.price - ls.price) / ls.price <= o.levelTolerance &&
        p.price > head.price &&
        p.price < neckline
    );
    const rs: Pivot | null =
      rsCandidates.length > 0 ? rsCandidates[rsCandidates.length - 1] : null;

    // Simmetria temporale: i due lati devono avere durate confrontabili
    if (rs) {
      const leftSpan = head.idx - ls.idx;
      const rightSpan = rs.idx - head.idx;
      const avg = (leftSpan + rightSpan) / 2;
      if (avg > 0 && Math.abs(leftSpan - rightSpan) / avg > TIME_ASYMMETRY_MAX) {
        continue;
      }
    }

    let state: FormationState;
    if (price > neckline) {
      state = 'confirmed';
    } else if (rs) {
      state = 'right_shoulder';
    } else {
      // Speculare: il prezzo deve essere ridisceso al livello della
      // spalla sinistra dopo il picco intermedio e aver gia' ripreso a
      // salire. Altrimenti e' un ritracciamento qualsiasi.
      const trough2 = troughBetween(candles, peak2.idx, lastIdx);
      if (!trough2) continue;
      const troughDiff = Math.abs(trough2.price - ls.price) / ls.price;
      const bouncing = price > trough2.price * (1 + ROLLOVER_MIN);
      const enoughTime = lastIdx - head.idx >= MIN_BARS_SINCE_HEAD;
      if (
        troughDiff <= o.levelTolerance &&
        bouncing &&
        enoughTime &&
        trough2.price > head.price
      ) {
        state = 'forming';
      } else {
        continue;
      }
    }

    const points: FormationPoint[] = [
      { time: candles[ls.idx].t, price: ls.price, label: 'Spalla sinistra' },
      { time: candles[head.idx].t, price: head.price, label: 'Testa' },
    ];
    if (rs) {
      points.push({
        time: candles[rs.idx].t,
        price: rs.price,
        label: 'Spalla destra',
      });
    }

    out.push({
      ticker,
      kind: 'IHS',
      direction: 'bullish',
      state,
      points,
      neckline,
      necklineFrom: { time: candles[peak1.idx].t, price: peak1.price },
      necklineTo: { time: candles[peak2.idx].t, price: peak2.price },
      price,
      distanceToNecklinePct: ((neckline - price) / price) * 100,
      depthPct,
      target: neckline + (neckline - head.price),
      barsSpan: span,
      lastDate: isoDate(candles[lastIdx].t),
    });
    break;
  }

  // ------------------------------------------------------------------
  // DOPPIO E TRIPLO MINIMO
  //
  // Due o tre minimi allo stesso livello, separati da risalite
  // significative e preceduti da una discesa.
  //
  // NIENTE LINEA DEL COLLO
  // Qui la figura non si conferma rompendo il massimo intermedio: si
  // completa quando il tocco finale sul supporto e' formato. Quello e'
  // il momento in cui il livello ha retto un'altra volta, ed e' li' che
  // serve l'avviso. Aspettare la rottura del massimo intermedio
  // significherebbe segnalare a movimento gia' avvenuto.
  //
  // Il livello di riferimento e' quindi il supporto stesso, cioe' la
  // media dei tocchi, non un collo.
  // ------------------------------------------------------------------
  {
    const touches = collectTouches(candles, lows, lastIdx, o, 'low');
    if (touches && touches.points.length >= 2) {
      const { points: tp, between } = touches;
      const level = tp.reduce((s2, t) => s2 + t.price, 0) / tp.length;
      const topBetween = Math.max(...between.map((b) => b.price));
      const depthPct = ((topBetween - level) / topBetween) * 100;
      const last = tp[tp.length - 1];
      const lastIsForming = lastIdx - last.idx <= o.rightBars;

      if (depthPct >= o.minDepthPct) {
        const triple = tp.length >= 3;
        const words = ['Primo', 'Secondo', 'Terzo', 'Quarto'];
        const points: FormationPoint[] = [];
        tp.forEach((t, k) => {
          const isLast = k === tp.length - 1;
          points.push({
            time: candles[t.idx].t,
            price: t.price,
            label: `${words[k] ?? ''} minimo${
              isLast && lastIsForming ? ' (in corso)' : ''
            }`.trim(),
          });
          const mid = between[k];
          if (mid && k < tp.length - 1) {
            points.push({
              time: candles[mid.idx].t,
              price: mid.price,
              label: 'Massimo',
            });
          }
        });

        out.push({
          ticker,
          kind: triple ? 'TRIPLE_BOTTOM' : 'DOUBLE_BOTTOM',
          direction: 'bullish',
          // Completata appena il tocco finale non e' piu' in corso
          state: lastIsForming ? 'forming' : 'confirmed',
          points,
          // Il livello dei tocchi, non un collo
          neckline: level,
          necklineFrom: { time: candles[tp[0].idx].t, price: level },
          necklineTo: { time: candles[lastIdx].t, price: level },
          price,
          distanceToNecklinePct: ((level - price) / price) * 100,
          depthPct,
          // Primo ostacolo sopra: il massimo piu' alto fra i tocchi
          target: topBetween,
          barsSpan: lastIdx - tp[0].idx,
          lastDate: isoDate(candles[lastIdx].t),
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // TESTA E SPALLE (ribassista)
  //
  // Speculare del rovesciato: salita, spalla sinistra, discesa al primo
  // minimo, massimo piu' alto (testa), discesa al secondo minimo, spalla
  // destra all'altezza della sinistra. Si conferma rompendo il collo
  // verso il BASSO.
  // ------------------------------------------------------------------
  for (let i = highs.length - 1; i >= 1; i--) {
    const head = highs[i];
    const ls = highs[i - 1];

    if (head.price <= ls.price * (1 + o.headDepthMin)) continue;

    const span = lastIdx - ls.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    if (prominenceHigh(candles, ls.idx, 25) < PIVOT_PROMINENCE_MIN) continue;
    if (prominenceHigh(candles, head.idx, 25) < PIVOT_PROMINENCE_MIN) continue;

    // Serve una salita precedente: e' un'inversione al ribasso
    if (!hasPriorRise(candles, ls.idx, 30, PRIOR_DECLINE_MIN)) continue;

    const valley1 = valleyBetween(candles, ls.idx, head.idx);
    if (!valley1) continue;
    const valley2 = valleyBetween(candles, head.idx, lastIdx);
    if (!valley2) continue;

    const slope =
      Math.abs(valley2.price - valley1.price) /
      Math.max(valley1.price, valley2.price);
    if (slope > NECKLINE_SLOPE_MAX) continue;

    const neckline = (valley1.price + valley2.price) / 2;
    if (!Number.isFinite(neckline) || neckline <= 0) continue;

    if (ls.price <= neckline || head.price <= neckline) continue;

    const depthPct = ((head.price - neckline) / neckline) * 100;
    if (depthPct < o.minDepthPct) continue;

    const rsCandidates = highs.filter(
      (p) =>
        p.idx > valley1.idx &&
        p.idx > head.idx &&
        Math.abs(p.price - ls.price) / ls.price <= o.levelTolerance &&
        p.price < head.price &&
        p.price > neckline
    );
    const rs: Pivot | null =
      rsCandidates.length > 0 ? rsCandidates[rsCandidates.length - 1] : null;

    if (rs) {
      const leftSpan = head.idx - ls.idx;
      const rightSpan = rs.idx - head.idx;
      const avg = (leftSpan + rightSpan) / 2;
      if (avg > 0 && Math.abs(leftSpan - rightSpan) / avg > TIME_ASYMMETRY_MAX) {
        continue;
      }
    }

    let state: FormationState;
    if (price < neckline) {
      state = 'confirmed';
    } else if (rs) {
      state = 'right_shoulder';
    } else {
      // Perche' si possa parlare di spalla destra in formazione non basta
      // che il prezzo sia dalle parti della spalla sinistra: deve essere
      // risalito fin li' dopo il minimo intermedio E aver gia' iniziato a
      // girare. Senza questo, ogni ritracciamento dentro un rialzo
      // veniva scambiato per una figura.
      const crest = peakOnly(candles, valley2.idx, lastIdx);
      if (!crest) continue;
      const crestDiff = Math.abs(crest.price - ls.price) / ls.price;
      const rolledOver = price < crest.price * (1 - ROLLOVER_MIN);
      const enoughTime = lastIdx - head.idx >= MIN_BARS_SINCE_HEAD;
      if (
        crestDiff <= o.levelTolerance &&
        rolledOver &&
        enoughTime &&
        crest.price < head.price
      ) {
        state = 'forming';
      } else {
        continue;
      }
    }

    const points: FormationPoint[] = [
      { time: candles[ls.idx].t, price: ls.price, label: 'Spalla sinistra' },
      { time: candles[head.idx].t, price: head.price, label: 'Testa' },
    ];
    if (rs) {
      points.push({
        time: candles[rs.idx].t,
        price: rs.price,
        label: 'Spalla destra',
      });
    }

    out.push({
      ticker,
      kind: 'HS',
      direction: 'bearish',
      state,
      points,
      neckline,
      necklineFrom: { time: candles[valley1.idx].t, price: valley1.price },
      necklineTo: { time: candles[valley2.idx].t, price: valley2.price },
      price,
      distanceToNecklinePct: ((neckline - price) / price) * 100,
      depthPct,
      target: neckline - (head.price - neckline),
      barsSpan: span,
      lastDate: isoDate(candles[lastIdx].t),
    });
    break;
  }

  // ------------------------------------------------------------------
  // DOPPIO E TRIPLO MASSIMO
  //
  // Lo specchio dei minimi: tocchi ripetuti su una resistenza, preceduti
  // da una salita. Anche qui niente linea del collo: la figura e'
  // completa quando il tocco finale e' formato.
  // ------------------------------------------------------------------
  {
    const touches = collectTouches(candles, highs, lastIdx, o, 'high');
    if (touches && touches.points.length >= 2) {
      const { points: tp, between } = touches;
      const level = tp.reduce((s2, t) => s2 + t.price, 0) / tp.length;
      const lowBetween = Math.min(...between.map((b) => b.price));
      const depthPct = ((level - lowBetween) / level) * 100;
      const last = tp[tp.length - 1];
      const lastIsForming = lastIdx - last.idx <= o.rightBars;

      if (depthPct >= o.minDepthPct) {
        const triple = tp.length >= 3;
        const words = ['Primo', 'Secondo', 'Terzo', 'Quarto'];
        const points: FormationPoint[] = [];
        tp.forEach((t, k) => {
          const isLast = k === tp.length - 1;
          points.push({
            time: candles[t.idx].t,
            price: t.price,
            label: `${words[k] ?? ''} massimo${
              isLast && lastIsForming ? ' (in corso)' : ''
            }`.trim(),
          });
          const mid = between[k];
          if (mid && k < tp.length - 1) {
            points.push({
              time: candles[mid.idx].t,
              price: mid.price,
              label: 'Minimo',
            });
          }
        });

        out.push({
          ticker,
          kind: triple ? 'TRIPLE_TOP' : 'DOUBLE_TOP',
          direction: 'bearish',
          state: lastIsForming ? 'forming' : 'confirmed',
          points,
          neckline: level,
          necklineFrom: { time: candles[tp[0].idx].t, price: level },
          necklineTo: { time: candles[lastIdx].t, price: level },
          price,
          distanceToNecklinePct: ((level - price) / price) * 100,
          depthPct,
          // Primo ostacolo sotto: il minimo piu' basso fra i tocchi
          target: lowBetween,
          barsSpan: lastIdx - tp[0].idx,
          lastDate: isoDate(candles[lastIdx].t),
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // CUNEO DISCENDENTE
  //
  // Due rette entrambe inclinate al ribasso che convergono: quella dei
  // massimi scende piu' rapidamente di quella dei minimi. Il prezzo si
  // comprime e la rottura avviene in genere verso l'alto.
  //
  // A differenza delle altre figure non c'e' una linea del collo
  // orizzontale: il livello di conferma e' la retta superiore, che si
  // abbassa a ogni seduta.
  // ------------------------------------------------------------------
  for (const wedgeKind of ['FALLING_WEDGE', 'RISING_WEDGE'] as const) {
    const bullishWedge = wedgeKind === 'FALLING_WEDGE';
    const WEDGE_MIN_BARS = 30;
    const WEDGE_MAX_BARS = 130;
    const MIN_TOUCHES = 3;
    const MIN_R2 = 0.7;
    /** Il cuneo deve restringersi almeno di questo: senza convergenza
     *  sono due rette parallele, cioe' un canale. */
    const MIN_CONVERGENCE = 0.35;

    for (let lookback = WEDGE_MAX_BARS; lookback >= WEDGE_MIN_BARS; lookback -= 15) {
      const from = lastIdx - lookback;
      if (from < 5) continue;

      const wHighs = highs.filter((p) => p.idx >= from);
      const wLows = lows.filter((p) => p.idx >= from);
      if (wHighs.length < MIN_TOUCHES || wLows.length < MIN_TOUCHES) continue;

      const up = linreg(wHighs.map((p) => p.idx), wHighs.map((p) => p.price));
      const lo = linreg(wLows.map((p) => p.idx), wLows.map((p) => p.price));
      if (up.r2 < MIN_R2 || lo.r2 < MIN_R2) continue;

      if (wedgeKind === 'FALLING_WEDGE') {
        // Entrambe scendono, e i massimi piu' in fretta dei minimi
        if (up.slope >= 0 || lo.slope >= 0) continue;
        if (up.slope >= lo.slope) continue;
      } else {
        // Cuneo ascendente: entrambe salgono, e i minimi piu' in fretta
        // dei massimi. La rottura avviene di norma verso il basso.
        if (up.slope <= 0 || lo.slope <= 0) continue;
        if (lo.slope <= up.slope) continue;
      }

      const startIdx = Math.min(wHighs[0].idx, wLows[0].idx);
      const widthStart = up.at(startIdx) - lo.at(startIdx);
      const widthNow = up.at(lastIdx) - lo.at(lastIdx);
      if (widthStart <= 0 || widthNow <= 0) continue;

      const convergence = 1 - widthNow / widthStart;
      if (convergence < MIN_CONVERGENCE) continue;

      const upperNow = up.at(lastIdx);
      const lowerNow = lo.at(lastIdx);

      // Il prezzo deve stare dentro il cuneo o averlo appena rotto nella
      // direzione attesa. Uscito dalla parte opposta, la figura e' fallita.
      if (bullishWedge) {
        if (price < lowerNow * 0.97) continue;
      } else if (price > upperNow * 1.03) {
        continue;
      }

      // Punto di rottura: l'ultima seduta ancora dentro il cuneo, piu'
      // uno. Serve anche per fermare li' il disegno delle rette.
      const insideAt = (i: number) =>
        bullishWedge ? candles[i].c <= up.at(i) : candles[i].c >= lo.at(i);

      let breakoutIdx: number | null = null;
      for (let i = lastIdx; i > from; i--) {
        if (insideAt(i)) {
          breakoutIdx = i + 1 <= lastIdx ? i + 1 : null;
          break;
        }
      }

      const brokeOut = bullishWedge ? price > upperNow : price < lowerNow;

      let state: FormationState;
      if (brokeOut && breakoutIdx != null) {
        // Conferma solo se la rottura e' recente: un cuneo rotto un mese
        // fa non e' piu' un'occasione
        if (lastIdx - breakoutIdx > 8) continue;
        state = 'confirmed';
      } else if (brokeOut) {
        continue; // fuori dalla retta da sempre: non e' una rottura
      } else if (convergence >= 0.5) {
        state = 'right_shoulder'; // compressione avanzata
      } else {
        state = 'forming';
      }

      // Le rette si fermano alla rottura, non proseguono fino a oggi
      const lineEndIdx = state === 'confirmed' && breakoutIdx != null
        ? breakoutIdx
        : lastIdx;

      const height = widthStart;
      const breakLevel = bullishWedge ? upperNow : lowerNow;

      out.push({
        ticker,
        kind: wedgeKind,
        direction: bullishWedge ? 'bullish' : 'bearish',
        state,
        points: [
          {
            time: candles[startIdx].t,
            price: bullishWedge ? up.at(startIdx) : lo.at(startIdx),
            label: 'Inizio cuneo',
          },
          { time: candles[lastIdx].t, price: breakLevel, label: 'Rottura' },
        ],
        neckline: breakLevel,
        necklineFrom: {
          time: candles[startIdx].t,
          price: bullishWedge ? up.at(startIdx) : lo.at(startIdx),
        },
        necklineTo: { time: candles[lastIdx].t, price: breakLevel },
        upperLine: {
          from: { time: candles[startIdx].t, price: up.at(startIdx), label: '' },
          to: {
            time: candles[lineEndIdx].t,
            price: up.at(lineEndIdx),
            label: '',
          },
        },
        lowerLine: {
          from: { time: candles[startIdx].t, price: lo.at(startIdx), label: '' },
          to: {
            time: candles[lineEndIdx].t,
            price: lo.at(lineEndIdx),
            label: '',
          },
        },
        convergencePct: convergence * 100,
        price,
        distanceToNecklinePct: ((breakLevel - price) / price) * 100,
        depthPct: (height / breakLevel) * 100,
        // Obiettivo classico: l'ampiezza iniziale del cuneo proiettata
        // dal punto di rottura, nella direzione della rottura
        target: bullishWedge ? breakLevel + height : breakLevel - height,
        barsSpan: lastIdx - startIdx,
        lastDate: isoDate(candles[lastIdx].t),
      });
      break; // un solo cuneo per titolo
    }
  }

  // ------------------------------------------------------------------
  // BANDIERE
  //
  // Struttura diversa dalle altre: un'asta, cioe' un movimento ripido e
  // breve, seguita da un canale stretto che deriva in direzione opposta.
  // La rottura avviene nella direzione dell'asta.
  //
  // Le rette qui si adattano ai massimi e minimi delle singole sedute,
  // non ai pivot: su una manciata di barre i pivot non esistono ancora.
  // ------------------------------------------------------------------
  {
    const POLE_MIN_PCT = 8;
    const POLE_MIN_BARS = 3;
    const POLE_MAX_BARS = 15;
    const FLAG_MIN_BARS = 6;
    const FLAG_MAX_BARS = 25;
    /** Quanto della salita puo' essere restituito dal consolidamento. */
    const MAX_RETRACEMENT = 0.5;
    /** Il canale deve essere stretto rispetto all'asta. */
    const MAX_CHANNEL_RATIO = 0.5;
    const MIN_CHANNEL_R2 = 0.45;

    type Best = { score: number; build: () => Formation } | null;
    let best: Best = null;

    for (const flagKind of ['BULL_FLAG', 'BEAR_FLAG'] as const) {
      const bull = flagKind === 'BULL_FLAG';

      for (let flagLen = FLAG_MIN_BARS; flagLen <= FLAG_MAX_BARS; flagLen++) {
        const flagStart = lastIdx - flagLen + 1;
        if (flagStart < POLE_MAX_BARS + 2) continue;

        for (let poleLen = POLE_MIN_BARS; poleLen <= POLE_MAX_BARS; poleLen++) {
          const poleStart = flagStart - poleLen;
          if (poleStart < 0) continue;

          const a = candles[poleStart].c;
          const b = candles[flagStart - 1].c;
          if (a <= 0 || b <= 0) continue;
          const polePct = ((b - a) / a) * 100;

          // L'asta deve essere ampia e nella direzione giusta
          if (bull ? polePct < POLE_MIN_PCT : polePct > -POLE_MIN_PCT) continue;
          const poleHeight = Math.abs(b - a);

          // Canale del consolidamento
          const xs: number[] = [];
          const hs: number[] = [];
          const ls: number[] = [];
          for (let i = flagStart; i <= lastIdx; i++) {
            xs.push(i);
            hs.push(candles[i].h);
            ls.push(candles[i].l);
          }
          const upFit = linreg(xs, hs);
          const loFit = linreg(xs, ls);
          if (upFit.r2 < MIN_CHANNEL_R2 && loFit.r2 < MIN_CHANNEL_R2) continue;

          // Il canale deriva contro l'asta, o al piu' resta piatto
          const drift = (upFit.slope + loFit.slope) / 2;
          const driftPct = (drift * flagLen) / b;
          if (bull ? driftPct > 0.02 : driftPct < -0.02) continue;

          // Ritracciamento contenuto: oltre meta' dell'asta non e' piu'
          // una pausa, e' un'inversione
          const extreme = bull
            ? Math.min(...ls)
            : Math.max(...hs);
          const retraced = Math.abs(b - extreme) / poleHeight;
          if (retraced > MAX_RETRACEMENT) continue;

          // Canale stretto rispetto all'asta
          const channelH = Math.abs(upFit.at(lastIdx) - loFit.at(lastIdx));
          if (channelH / poleHeight > MAX_CHANNEL_RATIO) continue;

          const upperNow = upFit.at(lastIdx);
          const lowerNow = loFit.at(lastIdx);
          const breakLevel = bull ? upperNow : lowerNow;
          const brokeOut = bull ? price > upperNow : price < lowerNow;

          // Uscita dalla parte sbagliata: la bandiera e' fallita
          if (bull ? price < lowerNow * 0.97 : price > upperNow * 1.03) continue;

          let state: FormationState;
          if (brokeOut) {
            state = 'confirmed';
          } else if (flagLen >= 12) {
            state = 'right_shoulder'; // consolidamento maturo
          } else {
            state = 'forming';
          }

          // Fra piu' combinazioni valide tengo quella con l'asta piu'
          // decisa e il canale piu' stretto
          const score =
            Math.abs(polePct) * 2 - (channelH / poleHeight) * 50 - retraced * 30;
          if (best && score <= best.score) continue;

          best = {
            score,
            build: () => ({
              ticker,
              kind: flagKind,
              direction: bull ? 'bullish' : 'bearish',
              state,
              points: [
                {
                  time: candles[poleStart].t,
                  price: a,
                  label: 'Inizio asta',
                },
                {
                  time: candles[flagStart - 1].t,
                  price: b,
                  label: 'Fine asta',
                },
              ],
              neckline: breakLevel,
              necklineFrom: {
                time: candles[flagStart].t,
                price: bull ? upFit.at(flagStart) : loFit.at(flagStart),
              },
              necklineTo: { time: candles[lastIdx].t, price: breakLevel },
              upperLine: {
                from: {
                  time: candles[flagStart].t,
                  price: upFit.at(flagStart),
                  label: '',
                },
                to: { time: candles[lastIdx].t, price: upperNow, label: '' },
              },
              lowerLine: {
                from: {
                  time: candles[flagStart].t,
                  price: loFit.at(flagStart),
                  label: '',
                },
                to: { time: candles[lastIdx].t, price: lowerNow, label: '' },
              },
              price,
              distanceToNecklinePct: ((breakLevel - price) / price) * 100,
              depthPct: (poleHeight / b) * 100,
              // Obiettivo classico: l'altezza dell'asta proiettata dal
              // punto di rottura
              target: bull
                ? breakLevel + poleHeight
                : breakLevel - poleHeight,
              barsSpan: lastIdx - poleStart,
              lastDate: isoDate(candles[lastIdx].t),
            }),
          };
        }
      }
    }

    if (best) out.push(best.build());
  }

  return out;
}
