/**
 * Cambio di stato del trend sulla media Hull 50 settimanale.
 *
 * La regola e' binaria e verificabile: se la candela settimanale chiude
 * sopra la HMA50 lo stato e' 'above', se chiude sotto e' 'below'. La
 * notifica scatta solo sul passaggio da uno stato all'altro.
 *
 * ACCORGIMENTO ESSENZIALE
 * L'ultima barra settimanale restituita da Yahoo e' la settimana IN
 * CORSO, che si chiude il venerdi'. Valutarla significherebbe segnalare
 * un incrocio che nei giorni successivi puo' rientrare. Qui si lavora
 * sempre sull'ultima settimana CHIUSA.
 */

import type { OHLCV } from './yahoo';
import { hma } from './indicators';

export type WeeklyState = 'above' | 'below';

export type WeeklyTrendResult = {
  ticker: string;
  /** Stato dell'ultima settimana chiusa */
  state: WeeklyState;
  /** Stato della settimana precedente */
  prevState: WeeklyState;
  /** true se lo stato e' cambiato sull'ultima settimana chiusa */
  flipped: boolean;
  /** Direzione dell'incrocio, se avvenuto */
  direction: 'bullish' | 'bearish' | null;

  close: number;
  hmaValue: number;
  /** Scostamento percentuale della chiusura dalla media */
  distancePct: number;

  /** Inizio della settimana valutata, secondi unix */
  barTime: number;
  /** Data della settimana valutata, formato ISO */
  barDate: string;
  /** true se l'ultima barra ricevuta era la settimana in corso ed e'
   *  stata scartata */
  droppedInProgress: boolean;
};

/** Inizio della settimana (lunedi' 00:00 UTC) che contiene il timestamp. */
function weekStart(tsSeconds: number): number {
  const d = new Date(tsSeconds * 1000);
  const day = d.getUTCDay(); // 0 = domenica
  const diff = day === 0 ? 6 : day - 1;
  const monday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - diff
  );
  return Math.floor(monday / 1000);
}

/**
 * Valuta un titolo sulle candele settimanali.
 * Ritorna null se non ci sono abbastanza barre per una HMA50 affidabile.
 *
 * @param weekly candele con interval '1wk', in ordine cronologico
 * @param now momento di riferimento, per riconoscere la settimana in corso
 */
export function evaluateWeeklyTrend(
  ticker: string,
  weekly: OHLCV[],
  period = 50,
  now: Date = new Date()
): WeeklyTrendResult | null {
  if (weekly.length < period + 12) return null;

  // Scarto la settimana in corso: la sua chiusura non e' definitiva
  const currentWeek = weekStart(Math.floor(now.getTime() / 1000));
  let bars = weekly;
  let droppedInProgress = false;
  const lastBar = bars[bars.length - 1];
  if (lastBar && weekStart(lastBar.t) >= currentWeek) {
    bars = bars.slice(0, -1);
    droppedInProgress = true;
  }
  if (bars.length < period + 11) return null;

  const closes = bars.map((c) => c.c);
  const hmaArr = hma(closes, period);

  const n = closes.length - 1;
  const cNow = closes[n];
  const cPrev = closes[n - 1];
  const hNow = hmaArr[n];
  const hPrev = hmaArr[n - 1];

  if (
    hNow == null ||
    hPrev == null ||
    !Number.isFinite(cNow) ||
    !Number.isFinite(cPrev)
  ) {
    return null;
  }

  const state: WeeklyState = cNow > hNow ? 'above' : 'below';
  const prevState: WeeklyState = cPrev > hPrev ? 'above' : 'below';
  const flipped = state !== prevState;

  return {
    ticker,
    state,
    prevState,
    flipped,
    direction: flipped ? (state === 'above' ? 'bullish' : 'bearish') : null,
    close: cNow,
    hmaValue: hNow,
    distancePct: ((cNow - hNow) / hNow) * 100,
    barTime: bars[n].t,
    barDate: new Date(bars[n].t * 1000).toISOString().slice(0, 10),
    droppedInProgress,
  };
}

/** Riga per la notifica Telegram. */
export function formatWeeklyFlipLine(r: WeeklyTrendResult): string {
  const arrow = r.direction === 'bullish' ? '↑' : '↓';
  return (
    `${arrow} <b>${r.ticker}</b> ${r.close.toFixed(2)} · ` +
    `HMA50 ${r.hmaValue.toFixed(2)} · ` +
    `${r.distancePct >= 0 ? '+' : ''}${r.distancePct.toFixed(1)}%`
  );
}
