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

export type FormationKind = 'IHS' | 'DOUBLE_BOTTOM';
export type FormationState = 'forming' | 'right_shoulder' | 'confirmed';

export const FORMATION_LABELS: Record<FormationKind, string> = {
  IHS: 'Testa e spalle rovesciato',
  DOUBLE_BOTTOM: 'Doppio minimo',
};

/**
 * Le etichette cambiano con la figura: parlare di "spalla destra" per un
 * doppio minimo non ha senso.
 */
export function stateLabel(kind: FormationKind, state: FormationState): string {
  if (state === 'confirmed') return 'Linea del collo rotta';
  if (state === 'forming') return 'In formazione';
  return kind === 'IHS' ? 'Spalla destra completata' : 'Secondo minimo formato';
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
  headDepthMin: 0.05,
  minDepthPct: 6,
  durationMin: 25,
  durationMax: 120,
  returnTolerance: 0.04,
};

/** Massima inclinazione ammessa per la linea del collo. */
const NECKLINE_SLOPE_MAX = 0.05;
/** Massima asimmetria temporale fra i due lati della figura. */
const TIME_ASYMMETRY_MAX = 0.6;
/** Discesa minima che deve precedere la figura: e' un'inversione. */
const PRIOR_DECLINE_MIN = 0.06;
/** Risalita minima da un minimo perche' sia strutturale e non un ritracciamento. */
const PIVOT_PROMINENCE_MIN = 0.04;

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
  if (lows.length < 2) return [];

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

    const distFromShoulder = Math.abs(price - ls.price) / ls.price;

    let state: FormationState;
    if (price > neckline) {
      state = 'confirmed';
    } else if (rs) {
      state = 'right_shoulder';
    } else if (
      distFromShoulder <= o.returnTolerance &&
      price > head.price &&
      lastIdx > peak2.idx
    ) {
      state = 'forming';
    } else {
      continue;
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

  return out;
}
