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

export const STATE_LABELS: Record<FormationState, string> = {
  forming: 'In formazione',
  right_shoulder: 'Spalla destra completata',
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
  leftBars: 5,
  rightBars: 5,
  levelTolerance: 0.06,
  headDepthMin: 0.03,
  minDepthPct: 5,
  durationMin: 15,
  durationMax: 120,
  returnTolerance: 0.07,
};

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
  // Servono spalla sinistra e testa confermate; la spalla destra e' il
  // presente.
  // ------------------------------------------------------------------
  for (let i = lows.length - 1; i >= 1; i--) {
    const head = lows[i];
    const ls = lows[i - 1];

    // La testa deve essere piu' profonda della spalla sinistra
    if (head.price >= ls.price * (1 - o.headDepthMin)) continue;

    const span = lastIdx - ls.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    // Linea del collo: massimo fra spalla sinistra e testa, proiettato
    const neckLeft = maxBetween(candles, ls.idx, head.idx);
    const neckRight = maxBetween(candles, head.idx, lastIdx);
    const neckline = Math.max(neckLeft.price, neckRight.price);
    if (!Number.isFinite(neckline) || neckline <= 0) continue;

    const depthPct = ((neckline - head.price) / neckline) * 100;
    if (depthPct < o.minDepthPct) continue;

    // Dove siamo adesso rispetto al livello della spalla sinistra
    const distFromShoulder = Math.abs(price - ls.price) / ls.price;

    // Eventuale spalla destra gia' formata: un minimo confermato dopo la
    // testa, a un livello simile alla spalla sinistra
    const rsCandidates = lows.filter(
      (p) =>
        p.idx > head.idx &&
        Math.abs(p.price - ls.price) / ls.price <= o.levelTolerance &&
        p.price > head.price
    );
    const rs: Pivot | null =
      rsCandidates.length > 0 ? rsCandidates[rsCandidates.length - 1] : null;

    let state: FormationState;
    if (price > neckline) {
      state = 'confirmed';
    } else if (rs) {
      state = 'right_shoulder';
    } else if (distFromShoulder <= o.returnTolerance && price > head.price) {
      // Il prezzo e' risalito dalla testa e si trova all'altezza della
      // spalla sinistra: e' il momento in cui la figura si intravede
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
      necklineFrom: { time: candles[neckLeft.idx].t, price: neckline },
      necklineTo: { time: candles[lastIdx].t, price: neckline },
      price,
      distanceToNecklinePct: ((neckline - price) / price) * 100,
      depthPct,
      target: neckline + (neckline - head.price),
      barsSpan: span,
      lastDate: isoDate(candles[lastIdx].t),
    });
    break; // una sola figura per titolo, la piu' recente
  }

  // ------------------------------------------------------------------
  // DOPPIO MINIMO
  // Serve il primo minimo confermato; il secondo puo' essere il presente.
  // ------------------------------------------------------------------
  for (let i = lows.length - 1; i >= 0; i--) {
    const l1 = lows[i];
    const span = lastIdx - l1.idx;
    if (span < o.durationMin || span > o.durationMax) continue;

    // Il picco fra il primo minimo e oggi: e' la linea del collo
    const peak = maxBetween(candles, l1.idx, lastIdx);
    if (peak.idx <= l1.idx) continue;
    const neckline = peak.price;
    const depthPct = ((neckline - l1.price) / neckline) * 100;
    if (depthPct < o.minDepthPct) continue;

    // Secondo minimo confermato allo stesso livello, dopo il picco
    const l2Candidates = lows.filter(
      (p) =>
        p.idx > peak.idx &&
        Math.abs(p.price - l1.price) / l1.price <= o.levelTolerance
    );
    const l2: Pivot | null =
      l2Candidates.length > 0 ? l2Candidates[l2Candidates.length - 1] : null;

    const distFromLow = Math.abs(price - l1.price) / l1.price;

    let state: FormationState;
    if (l2 && price > neckline) {
      state = 'confirmed';
    } else if (l2) {
      state = 'right_shoulder';
    } else if (distFromLow <= o.returnTolerance && lastIdx > peak.idx) {
      // Il prezzo e' tornato all'altezza del primo minimo dopo esserne
      // risalito: potrebbe formarsi il secondo
      state = 'forming';
    } else {
      continue;
    }

    const points: FormationPoint[] = [
      { time: candles[l1.idx].t, price: l1.price, label: 'Primo minimo' },
      { time: candles[peak.idx].t, price: peak.price, label: 'Massimo' },
    ];
    if (l2) {
      points.push({
        time: candles[l2.idx].t,
        price: l2.price,
        label: 'Secondo minimo',
      });
    }

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
