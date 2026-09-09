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
  | 'HS'
  | 'DOUBLE_TOP'
  | 'FALLING_WEDGE';
export type FormationDirection = 'bullish' | 'bearish';
export type FormationState = 'forming' | 'right_shoulder' | 'confirmed';

export const FORMATION_LABELS: Record<FormationKind, string> = {
  IHS: 'Testa e spalle rovesciato',
  DOUBLE_BOTTOM: 'Doppio minimo',
  HS: 'Testa e spalle',
  DOUBLE_TOP: 'Doppio massimo',
  FALLING_WEDGE: 'Cuneo discendente',
};

export const FORMATION_DIRECTION: Record<FormationKind, FormationDirection> = {
  IHS: 'bullish',
  DOUBLE_BOTTOM: 'bullish',
  HS: 'bearish',
  DOUBLE_TOP: 'bearish',
  FALLING_WEDGE: 'bullish',
};

/**
 * Le etichette cambiano con la figura: parlare di "spalla destra" per un
 * doppio minimo non ha senso.
 */
export function stateLabel(kind: FormationKind, state: FormationState): string {
  if (state === 'confirmed') return 'Linea del collo rotta';
  if (state === 'forming') return 'In formazione';
  if (kind === 'FALLING_WEDGE') return 'Cuneo in compressione';
  if (kind === 'IHS' || kind === 'HS') return 'Spalla destra completata';
  return kind === 'DOUBLE_TOP'
    ? 'Secondo massimo formato'
    : 'Secondo minimo formato';
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
  // DOPPIO MINIMO
  //
  // Due minimi allo stesso livello separati da un picco significativo,
  // preceduti da una discesa. Il secondo minimo non deve scendere sotto
  // il primo in modo apprezzabile: altrimenti non e' un doppio minimo,
  // e' una discesa che continua.
  // ------------------------------------------------------------------
  for (let i = lows.length - 1; i >= 0; i--) {
    const l1 = lows[i];
    const span = lastIdx - l1.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    if (prominence(candles, l1.idx, 25) < PIVOT_PROMINENCE_MIN) continue;
    if (!hasPriorDecline(candles, l1.idx, 30, PRIOR_DECLINE_MIN)) continue;

    const peak = peakBetween(candles, l1.idx, lastIdx);
    if (!peak) continue;
    const neckline = peak.price;
    const depthPct = ((neckline - l1.price) / neckline) * 100;
    if (depthPct < o.minDepthPct) continue;

    // Il secondo minimo e' il punto PIU' BASSO dopo il picco, non
    // l'ultimo pivot che rientrava nella tolleranza. Prendere un pivot
    // intermedio quando il prezzo e' poi sceso ancora significa
    // segnalare una figura che nel frattempo si e' rotta.
    const trough = troughBetween(candles, peak.idx, lastIdx);
    if (!trough) continue;
    // Due minimi troppo ravvicinati sono un'oscillazione, non una figura
    if (trough.idx - l1.idx < MIN_BARS_BETWEEN_EXTREMES) continue;

    // Il minimo reale deve stare allo stesso livello del primo: e' la
    // condizione che definisce un doppio minimo. Se e' sceso sotto oltre
    // la tolleranza, il supporto ha ceduto e la figura non c'e'.
    const levelDiff = Math.abs(trough.price - l1.price) / l1.price;
    if (levelDiff > o.levelTolerance) continue;

    // E' gia' confermato come pivot, oppure si sta ancora formando?
    const l2 = lows.find(
      (p) => p.idx > peak.idx && Math.abs(p.idx - trough.idx) <= 2
    );
    const troughIsRecent = lastIdx - trough.idx <= o.rightBars;

    // Simmetria: il secondo minimo non deve arrivare troppo presto
    if (l2) {
      const leftSpan = peak.idx - l1.idx;
      const rightSpan = l2.idx - peak.idx;
      const avg = (leftSpan + rightSpan) / 2;
      if (avg > 0 && Math.abs(leftSpan - rightSpan) / avg > TIME_ASYMMETRY_MAX) {
        continue;
      }
    }

    let state: FormationState;
    if (l2 && price > neckline) {
      state = 'confirmed';
    } else if (l2 && !troughIsRecent) {
      // Minimo confermato e ormai alle spalle: struttura completa
      state = 'right_shoulder';
    } else {
      // Il minimo si sta ancora formando adesso
      state = 'forming';
    }

    const points: FormationPoint[] = [
      { time: candles[l1.idx].t, price: l1.price, label: 'Primo minimo' },
      { time: candles[peak.idx].t, price: peak.price, label: 'Massimo' },
    ];
    points.push({
      time: candles[trough.idx].t,
      price: trough.price,
      label: troughIsRecent ? 'Secondo minimo (in corso)' : 'Secondo minimo',
    });

    out.push({
      ticker,
      kind: 'DOUBLE_BOTTOM',
      direction: 'bullish',
      state,
      points,
      neckline,
      necklineFrom: { time: candles[peak.idx].t, price: neckline },
      necklineTo: { time: candles[lastIdx].t, price: neckline },
      price,
      distanceToNecklinePct: ((neckline - price) / price) * 100,
      depthPct,
      target: neckline + (neckline - l1.price),
      barsSpan: span,
      lastDate: isoDate(candles[lastIdx].t),
    });
    break;
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
  // DOPPIO MASSIMO
  //
  // Due massimi allo stesso livello separati da un minimo significativo,
  // preceduti da una salita. Si conferma rompendo quel minimo.
  // ------------------------------------------------------------------
  for (let i = highs.length - 1; i >= 0; i--) {
    const h1 = highs[i];
    const span = lastIdx - h1.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    if (prominenceHigh(candles, h1.idx, 25) < PIVOT_PROMINENCE_MIN) continue;
    if (!hasPriorRise(candles, h1.idx, 30, PRIOR_DECLINE_MIN)) continue;

    const valley = valleyBetween(candles, h1.idx, lastIdx);
    if (!valley) continue;
    const neckline = valley.price;
    const depthPct = ((h1.price - neckline) / h1.price) * 100;
    if (depthPct < o.minDepthPct) continue;

    // Il secondo massimo e' il punto piu' alto dopo il minimo intermedio
    const crest = peakOnly(candles, valley.idx, lastIdx);
    if (!crest) continue;
    if (crest.idx - h1.idx < MIN_BARS_BETWEEN_EXTREMES) continue;

    const levelDiff = Math.abs(crest.price - h1.price) / h1.price;
    if (levelDiff > o.levelTolerance) continue;

    const h2 = highs.find(
      (p) => p.idx > valley.idx && Math.abs(p.idx - crest.idx) <= 2
    );
    const crestIsRecent = lastIdx - crest.idx <= o.rightBars;

    let state: FormationState;
    if (h2 && price < neckline) {
      state = 'confirmed';
    } else if (h2 && !crestIsRecent) {
      state = 'right_shoulder';
    } else {
      state = 'forming';
    }

    const points: FormationPoint[] = [
      { time: candles[h1.idx].t, price: h1.price, label: 'Primo massimo' },
      { time: candles[valley.idx].t, price: valley.price, label: 'Minimo' },
      {
        time: candles[crest.idx].t,
        price: crest.price,
        label: crestIsRecent ? 'Secondo massimo (in corso)' : 'Secondo massimo',
      },
    ];

    out.push({
      ticker,
      kind: 'DOUBLE_TOP',
      direction: 'bearish',
      state,
      points,
      neckline,
      necklineFrom: { time: candles[valley.idx].t, price: neckline },
      necklineTo: { time: candles[lastIdx].t, price: neckline },
      price,
      distanceToNecklinePct: ((neckline - price) / price) * 100,
      depthPct,
      target: neckline - (h1.price - neckline),
      barsSpan: span,
      lastDate: isoDate(candles[lastIdx].t),
    });
    break;
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
  {
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

      // Entrambe devono scendere: e' un cuneo discendente
      if (up.slope >= 0 || lo.slope >= 0) continue;
      // E i massimi devono scendere piu' in fretta dei minimi
      if (up.slope >= lo.slope) continue;

      const startIdx = Math.min(wHighs[0].idx, wLows[0].idx);
      const widthStart = up.at(startIdx) - lo.at(startIdx);
      const widthNow = up.at(lastIdx) - lo.at(lastIdx);
      if (widthStart <= 0 || widthNow <= 0) continue;

      const convergence = 1 - widthNow / widthStart;
      if (convergence < MIN_CONVERGENCE) continue;

      const upperNow = up.at(lastIdx);
      const lowerNow = lo.at(lastIdx);

      // Il prezzo deve stare dentro il cuneo, o averlo appena rotto al
      // rialzo. Se e' sceso sotto la retta inferiore la figura e' fallita.
      if (price < lowerNow * 0.97) continue;

      let state: FormationState;
      if (price > upperNow) {
        // Conferma solo se la rottura e' recente: un cuneo rotto un mese
        // fa non e' piu' un'occasione
        let brokeAt: number | null = null;
        for (let i = lastIdx; i >= Math.max(from, lastIdx - 8); i--) {
          if (candles[i].c > up.at(i)) brokeAt = i;
          else break;
        }
        if (brokeAt == null) continue;
        state = 'confirmed';
      } else if (convergence >= 0.5) {
        state = 'right_shoulder'; // compressione avanzata
      } else {
        state = 'forming';
      }

      const height = widthStart;
      out.push({
        ticker,
        kind: 'FALLING_WEDGE',
        direction: 'bullish',
        state,
        points: [
          {
            time: candles[startIdx].t,
            price: up.at(startIdx),
            label: 'Inizio cuneo',
          },
          { time: candles[lastIdx].t, price: upperNow, label: 'Rottura' },
        ],
        neckline: upperNow,
        necklineFrom: { time: candles[startIdx].t, price: up.at(startIdx) },
        necklineTo: { time: candles[lastIdx].t, price: upperNow },
        upperLine: {
          from: { time: candles[startIdx].t, price: up.at(startIdx), label: '' },
          to: { time: candles[lastIdx].t, price: upperNow, label: '' },
        },
        lowerLine: {
          from: { time: candles[startIdx].t, price: lo.at(startIdx), label: '' },
          to: { time: candles[lastIdx].t, price: lowerNow, label: '' },
        },
        convergencePct: convergence * 100,
        price,
        distanceToNecklinePct: ((upperNow - price) / price) * 100,
        depthPct: (height / upperNow) * 100,
        // Obiettivo classico: l'ampiezza iniziale del cuneo proiettata
        // dal punto di rottura
        target: upperNow + height,
        barsSpan: lastIdx - startIdx,
        lastDate: isoDate(candles[lastIdx].t),
      });
      break; // un solo cuneo per titolo
    }
  }

  return out;
}
