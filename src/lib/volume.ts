/**
 * Analisi dei volumi: chi scambia di piu' in assoluto e chi scambia
 * molto piu' del proprio normale.
 *
 * IL PROBLEMA DEL CONFRONTO A MERCATO APERTO
 * Yahoo riporta il volume accumulato finora e la media degli ultimi tre
 * mesi, che e' una media di giornate intere. Dividere l'uno per l'altra
 * a meta' seduta darebbe rapporti tutti bassi e privi di senso: alle
 * 11 del mattino ha scambiato forse un terzo della giornata, quindi
 * anche un titolo frenetico sembrerebbe fermo.
 *
 * Il volume pero' non si distribuisce in modo uniforme: si concentra in
 * apertura e ancor di piu' in chiusura, con un lungo avvallamento a
 * meta' giornata. Si stima quindi quanta parte di una giornata normale
 * dovrebbe aver gia' scambiato a quest'ora, e si confronta con quella.
 *
 * La curva sotto e' un'approssimazione del mercato USA nel suo insieme:
 * il singolo titolo puo' discostarsene, e nei primi minuti l'errore
 * relativo e' comunque grande. Serve a rendere il confronto leggibile
 * durante la giornata, non a essere esatta.
 */

import { getMarketSession } from './market-hours';
import type { BatchQuote } from './yahoo-market';

/**
 * Quota di volume giornaliero gia' scambiata a ogni mezz'ora della
 * sessione regolare (9:30-16:00 di New York, 390 minuti).
 *
 * Il salto finale e' l'asta di chiusura, che da sola vale una fetta
 * consistente della giornata.
 */
const INTRADAY_CURVE = [
  0,     // 9:30
  0.13,  // 10:00
  0.21,  // 10:30
  0.275, // 11:00
  0.33,  // 11:30
  0.38,  // 12:00
  0.425, // 12:30
  0.465, // 13:00
  0.505, // 13:30
  0.55,  // 14:00
  0.6,   // 14:30
  0.655, // 15:00
  0.725, // 15:30
  1,     // 16:00
];

const SESSION_MINUTES = 390;
const STEP_MINUTES = 30;

/**
 * Quota attesa di volume giornaliero a un dato minuto della sessione,
 * interpolando fra i punti della curva.
 */
export function expectedVolumeFraction(minutesIntoSession: number): number {
  if (minutesIntoSession <= 0) return 0;
  if (minutesIntoSession >= SESSION_MINUTES) return 1;

  const pos = minutesIntoSession / STEP_MINUTES;
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = INTRADAY_CURVE[i];
  const b = INTRADAY_CURVE[Math.min(i + 1, INTRADAY_CURVE.length - 1)];
  return a + (b - a) * frac;
}

/**
 * Quota di giornata gia' trascorsa, secondo la sessione in corso.
 *
 * Fuori dalla sessione regolare vale 1: il volume riportato e' quello
 * di una giornata intera, quindi il confronto e' diretto. In pre-market
 * il campo volume di Yahoo e' ancora quello della seduta precedente,
 * e questo caso viene gestito dal chiamante.
 */
export function sessionProgress(now: Date = new Date()): {
  fraction: number;
  session: string;
  etTime: string;
  /** Il volume riportato si riferisce a una giornata gia' chiusa */
  complete: boolean;
} {
  const info = getMarketSession(now);

  if (info.session === 'regular') {
    const mins = info.minutesIntoSession ?? 0;
    return {
      // Mai sotto una soglia minima: nei primissimi minuti dividere per
      // un numero quasi nullo produrrebbe rapporti enormi e insensati
      fraction: Math.max(0.02, expectedVolumeFraction(mins)),
      session: info.session,
      etTime: info.etTime,
      complete: false,
    };
  }

  return {
    fraction: 1,
    session: info.session,
    etTime: info.etTime,
    complete: true,
  };
}

export type VolumeRow = {
  ticker: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  exchangeName: string | null;
  /** Volume scambiato finora nella sessione */
  volume: number;
  /** Media giornaliera degli ultimi tre mesi */
  avgVolume: number | null;
  /** Controvalore scambiato: volume per prezzo */
  turnover: number | null;
  /**
   * Quante volte il proprio normale, gia' corretto per la parte di
   * giornata trascorsa. 1 = in linea con il solito, 3 = tre volte tanto.
   */
  volumeRatio: number | null;
};

export type VolumeOptions = {
  /** Quota di giornata gia' trascorsa, da sessionProgress */
  progress: number;
  /**
   * Media giornaliera minima perche' il rapporto abbia senso. Un titolo
   * che di norma scambia diecimila pezzi arriva a dieci volte tanto con
   * un ordine solo: senza questa soglia la classifica dei rapporti si
   * riempirebbe di titoli illiquidi.
   */
  minAvgVolume?: number;
  /** Controvalore minimo scambiato, stessa ragione */
  minTurnover?: number;
};

export const DEFAULT_MIN_AVG_VOLUME = 200_000;
export const DEFAULT_MIN_TURNOVER = 1_000_000;

/** Da quotazione a lotti a riga di volume, con il rapporto corretto. */
export function toVolumeRow(
  q: BatchQuote,
  opts: VolumeOptions
): VolumeRow | null {
  const volume = q.regularMarketVolume;
  if (volume == null || volume <= 0) return null;

  const price = q.regularMarketPrice;
  const avg = q.averageVolume3m;
  const turnover = price != null && price > 0 ? volume * price : null;

  // Il rapporto si calcola solo dove la media esiste ed e' significativa
  let volumeRatio: number | null = null;
  if (avg != null && avg > 0) {
    const atteso = avg * opts.progress;
    if (atteso > 0) volumeRatio = volume / atteso;
  }

  return {
    ticker: q.symbol,
    name: q.name,
    price,
    changePct: q.regularMarketChangePercent,
    currency: q.currency,
    exchangeName: q.exchangeName,
    volume,
    avgVolume: avg,
    turnover,
    volumeRatio,
  };
}

/** Il titolo e' abbastanza liquido perche' il rapporto significhi qualcosa */
export function isLiquidEnough(r: VolumeRow, opts: VolumeOptions): boolean {
  const minAvg = opts.minAvgVolume ?? DEFAULT_MIN_AVG_VOLUME;
  const minTurn = opts.minTurnover ?? DEFAULT_MIN_TURNOVER;
  if (r.avgVolume == null || r.avgVolume < minAvg) return false;
  if (r.turnover == null || r.turnover < minTurn) return false;
  return true;
}
