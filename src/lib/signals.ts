/**
 * Signal detection engine.
 *
 * Regola (dalla versione desktop):
 *  - Incrocio al rialzo tra prezzo e Hull MA 50
 *  - Più forte se vicino all'incrocio
 *  - Conferma: ultima candela Heikin Ashi è verde e senza wick inferiore
 *
 * Forza:
 *  3 = FORTE  → incrocio nelle ultime 1-2 candele + HA bullish "pulita"
 *  2 = MEDIO  → incrocio recente (3-5 candele) con HA bullish
 *  1 = DEBOLE → prezzo sopra HMA e HA bullish, ma incrocio più vecchio
 *  0 = NONE
 *
 * Le due condizioni restano legate nel segnale, ma vengono riportate
 * anche separatamente: l'incrocio della Hull e il passaggio delle
 * Heikin Ashi da rosse a verdi sono due eventi distinti, e vederli
 * isolati serve a capire quale dei due manca. Il segnale vero, e quindi
 * la notifica, resta la loro combinazione.
 */

import type { OHLCV } from './yahoo';
import { hma, heikinAshi, isBullishHANoLowerWick } from './indicators';

export type SignalStrength = 0 | 1 | 2 | 3;

export type Signal = {
  ticker: string;
  strength: SignalStrength;
  price: number;
  hmaValue: number;
  distancePct: number; // (price - hma) / hma * 100
  crossedBarsAgo: number | null;
  changePct: number; // variazione % giornaliera
  haBullish: boolean;
  /**
   * Sedute dalla PRIMA Heikin Ashi verde senza ombra inferiore della
   * serie verde in corso: 0 significa che il cambio da rosso a verde è
   * avvenuto con l'ultima candela. null se la serie verde non è in
   * corso. È l'evento che Andrea vuole vedere isolato.
   */
  haFlipBarsAgo: number | null;
  details: string;
  timestamp: number; // unix seconds dell'ultima candela
};

export type StrategyConfig = {
  hmaPeriod: number; // default 50
  lookback: number; // quante barre indietro cerco l'incrocio, default 10
};

export const DEFAULT_STRATEGY: StrategyConfig = {
  hmaPeriod: 50,
  lookback: 10,
};

/**
 * Valuta un ticker e restituisce un Signal (anche con strength 0).
 */
export function evaluateSignal(
  ticker: string,
  candles: OHLCV[],
  cfg: StrategyConfig = DEFAULT_STRATEGY
): Signal | null {
  if (candles.length < cfg.hmaPeriod + 5) return null;

  const closes = candles.map((c) => c.c);
  const hmaArr = hma(closes, cfg.hmaPeriod);
  const ha = heikinAshi(candles);

  const last = candles.length - 1;
  const price = closes[last];
  const hmaNow = hmaArr[last];
  if (hmaNow == null) return null;

  // Cerca l'incrocio più recente: barra i in cui close passa da <= hma a > hma
  let crossBarsAgo: number | null = null;
  for (let i = last; i >= Math.max(1, last - cfg.lookback); i--) {
    const prevClose = closes[i - 1];
    const prevHma = hmaArr[i - 1];
    const curClose = closes[i];
    const curHma = hmaArr[i];
    if (prevHma == null || curHma == null) continue;
    if (prevClose <= prevHma && curClose > curHma) {
      crossBarsAgo = last - i;
      break;
    }
  }

  const haLast = ha[last];
  const haBull = isBullishHANoLowerWick(haLast);

  // Da quante sedute dura la serie verde pulita in corso: si risale
  // finché le candele restano conformi, e la prima e' il cambio
  let haFlipBarsAgo: number | null = null;
  if (haBull) {
    let i = last;
    while (i - 1 >= 0 && isBullishHANoLowerWick(ha[i - 1])) i--;
    haFlipBarsAgo = last - i;
  }

  const distancePct = ((price - hmaNow) / hmaNow) * 100;
  const prevClose = closes[last - 1] ?? price;
  const changePct = ((price - prevClose) / prevClose) * 100;

  // Determina forza
  let strength: SignalStrength = 0;
  let details = '';

  if (price > hmaNow && haBull) {
    if (crossBarsAgo != null && crossBarsAgo <= 1) {
      strength = 3;
      details =
        haFlipBarsAgo === 0
          ? `Incrocio fresco (${crossBarsAgo}d) + prima HA verde pulita`
          : `Incrocio fresco (${crossBarsAgo}d) + HA verde pulita`;
    } else if (crossBarsAgo != null && crossBarsAgo <= 5) {
      strength = 2;
      details = `Incrocio ${crossBarsAgo}d fa + HA bullish`;
    } else {
      strength = 1;
      details = `Trend rialzista sopra HMA + HA bullish`;
    }
  } else if (price > hmaNow) {
    details = `Sopra HMA ma HA non conferma`;
  } else {
    details = `Prezzo sotto HMA`;
  }

  return {
    ticker,
    strength,
    price,
    hmaValue: hmaNow,
    distancePct,
    crossedBarsAgo: crossBarsAgo,
    changePct,
    haBullish: haBull,
    haFlipBarsAgo,
    details,
    timestamp: candles[last].t,
  };
}

/**
 * Scansione di più ticker. Filtra i segnali con strength >= minStrength.
 */
export async function scanTickers(
  candlesByTicker: Record<string, OHLCV[]>,
  minStrength: SignalStrength = 1,
  cfg: StrategyConfig = DEFAULT_STRATEGY
): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const [ticker, candles] of Object.entries(candlesByTicker)) {
    const s = evaluateSignal(ticker, candles, cfg);
    if (s && s.strength >= minStrength) out.push(s);
  }
  // Ordina: forza DESC, poi variazione DESC
  out.sort((a, b) => b.strength - a.strength || b.changePct - a.changePct);
  return out;
}
