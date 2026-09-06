/**
 * Rilevamento dei gap di apertura e analisi della loro chiusura.
 *
 * DEFINIZIONE STRETTA
 * Un gap esiste solo quando non c'e' sovrapposizione fra le due giornate:
 * apertura sopra il massimo precedente (rialzo) o sotto il minimo
 * precedente (ribasso). La definizione larga, basata sulla sola chiusura
 * precedente, produrrebbe centinaia di casi al giorno privi di
 * significato.
 *
 * QUANDO UN GAP E' CHIUSO
 * Quando il prezzo torna a toccare la chiusura precedente al gap. Per un
 * gap al rialzo serve un minimo successivo che scenda fino a quel
 * livello.
 *
 * IL PROBLEMA DELLA PERCENTUALE DI CHIUSURA
 * Senza un orizzonte temporale la percentuale tende al 100%: con
 * abbastanza tempo quasi ogni livello viene ritoccato, il che rende il
 * dato vero e inutile insieme. Qui si misura entro 5, 20 e 60 sedute.
 *
 * Inoltre i gap troppo recenti non hanno ancora avuto tempo di
 * chiudersi: contarli fra i "non chiusi" abbasserebbe artificialmente la
 * percentuale. Per ogni orizzonte si conteggiano solo i gap che hanno
 * almeno quel numero di sedute successive disponibili.
 */

import type { OHLCV } from './yahoo';

export type GapDirection = 'up' | 'down';

export type Gap = {
  ticker: string;
  direction: GapDirection;
  /** Data della seduta in cui si e' aperto il gap */
  date: string;
  idx: number;
  /** Ampiezza rispetto alla chiusura precedente, in percentuale */
  gapPct: number;
  openPrice: number;
  /** Livello da raggiungere per considerarlo chiuso */
  targetPrice: number;
  /** Estremo della seduta precedente: bordo del vuoto sul grafico */
  edgePrice: number;
  filled: boolean;
  fillDate: string | null;
  daysToFill: number | null;
  /** Sedute trascorse dall'apertura, se ancora aperto */
  daysOpen: number | null;
  /** Volume della seduta del gap */
  volume: number;
  /** Media dei volumi delle 20 sedute precedenti */
  avgVolume: number;
  /** Quante volte la media: distingue i gap da notizia da quelli ordinari */
  volumeRatio: number | null;
};

export const FILL_HORIZONS = [5, 20, 60] as const;

export type GapStats = {
  ticker: string;
  totalGaps: number;
  /** Per ciascun orizzonte: chiusi e quanti erano valutabili */
  filledWithin: Record<number, { filled: number; eligible: number }>;
  medianDaysToFill: number | null;
  openGaps: number;
};

export type TickerGapAnalysis = {
  stats: GapStats;
  /** Solo i gap ancora aperti alla fine dello storico */
  openGaps: Gap[];
  /** Tutti i gap rilevati, per il salvataggio */
  allGaps: Gap[];
};

function isoDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export function analyzeGaps(
  ticker: string,
  candles: OHLCV[],
  minGapPct = 2
): TickerGapAnalysis | null {
  if (candles.length < 30) return null;

  const lastIdx = candles.length - 1;
  const allGaps: Gap[] = [];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!prev.c || prev.c <= 0 || !cur.o) continue;

    let direction: GapDirection | null = null;
    let edgePrice = 0;

    // Definizione stretta: nessuna sovrapposizione con la seduta prima
    if (cur.o > prev.h) {
      direction = 'up';
      edgePrice = prev.h;
    } else if (cur.o < prev.l) {
      direction = 'down';
      edgePrice = prev.l;
    }
    if (!direction) continue;

    const target = prev.c;
    const gapPct = ((cur.o - target) / target) * 100;
    if (Math.abs(gapPct) < minGapPct) continue;

    // Ricerca della chiusura nelle sedute successive
    let filled = false;
    let fillIdx: number | null = null;
    for (let j = i + 1; j < candles.length; j++) {
      if (direction === 'up' ? candles[j].l <= target : candles[j].h >= target) {
        filled = true;
        fillIdx = j;
        break;
      }
    }

    // Volume relativo della seduta del gap. Nella classificazione classica
    // un gap su volume elevato nasce da una notizia e tende a proseguire,
    // uno su volume ordinario si richiude in fretta: e' un'ipotesi che i
    // dati raccolti qui permettono di verificare invece di assumere.
    let volSum = 0;
    let volCount = 0;
    for (let k = Math.max(0, i - 20); k < i; k++) {
      const v = candles[k].v;
      if (v && v > 0) {
        volSum += v;
        volCount++;
      }
    }
    const avgVolume = volCount >= 5 ? volSum / volCount : 0;
    const volume = cur.v ?? 0;

    allGaps.push({
      ticker,
      direction,
      date: isoDate(cur.t),
      idx: i,
      gapPct,
      openPrice: cur.o,
      targetPrice: target,
      edgePrice,
      filled,
      fillDate: fillIdx != null ? isoDate(candles[fillIdx].t) : null,
      daysToFill: fillIdx != null ? fillIdx - i : null,
      daysOpen: filled ? null : lastIdx - i,
      volume,
      avgVolume,
      volumeRatio: avgVolume > 0 && volume > 0 ? volume / avgVolume : null,
    });
  }

  // --- Statistiche ---------------------------------------------------
  const filledWithin: Record<number, { filled: number; eligible: number }> = {};
  for (const h of FILL_HORIZONS) filledWithin[h] = { filled: 0, eligible: 0 };

  const daysList: number[] = [];
  for (const g of allGaps) {
    if (g.daysToFill != null) daysList.push(g.daysToFill);
    for (const h of FILL_HORIZONS) {
      // Valutabile solo se ci sono almeno h sedute dopo il gap: senza
      // questo filtro i gap recenti risulterebbero "non chiusi" per il
      // solo fatto di essere recenti
      const hasRoom = lastIdx - g.idx >= h;
      if (!hasRoom) continue;
      filledWithin[h].eligible += 1;
      if (g.daysToFill != null && g.daysToFill <= h) filledWithin[h].filled += 1;
    }
  }

  daysList.sort((a, b) => a - b);
  const medianDaysToFill =
    daysList.length > 0
      ? daysList.length % 2 === 1
        ? daysList[(daysList.length - 1) / 2]
        : (daysList[daysList.length / 2 - 1] + daysList[daysList.length / 2]) / 2
      : null;

  const openGaps = allGaps.filter((g) => !g.filled);

  return {
    stats: {
      ticker,
      totalGaps: allGaps.length,
      filledWithin,
      medianDaysToFill,
      openGaps: openGaps.length,
    },
    openGaps,
    allGaps,
  };
}

/** Riga per la notifica Telegram. */
export function formatGapLine(g: Gap): string {
  const arrow = g.direction === 'up' ? '⬆️' : '⬇️';
  const vol =
    g.volumeRatio != null ? ` · vol ${g.volumeRatio.toFixed(1)}×` : '';
  return (
    `${arrow} <b>${g.ticker}</b> ${g.gapPct >= 0 ? '+' : ''}${g.gapPct.toFixed(1)}%${vol}\n` +
    `   apertura ${g.openPrice.toFixed(2)} · chiude a ${g.targetPrice.toFixed(2)}`
  );
}

/**
 * Fasce di volume usate per confrontare i tassi di chiusura.
 * La domanda a cui servono: i gap su volume elevato si richiudono
 * davvero meno di quelli ordinari?
 */
export const VOLUME_BUCKETS = [
  { key: 'low', label: 'fino a 1,5×', min: 0, max: 1.5 },
  { key: 'mid', label: 'da 1,5× a 3×', min: 1.5, max: 3 },
  { key: 'high', label: 'oltre 3×', min: 3, max: Infinity },
] as const;

export function bucketOf(ratio: number | null): string | null {
  if (ratio == null) return null;
  for (const b of VOLUME_BUCKETS) {
    if (ratio >= b.min && ratio < b.max) return b.key;
  }
  return null;
}
