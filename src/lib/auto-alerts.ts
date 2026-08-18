/**
 * Regole di alert automatiche basate sul minimo di periodo.
 *
 * Un alert manuale ha una soglia fissa su un singolo titolo. Una regola
 * si applica a un intero mercato e ricalcola la soglia a ogni scansione:
 * "avvisami quando un titolo scende sotto il minimo a 6 mesi +10%".
 *
 * DUE ACCORGIMENTI CHE CONTANO
 *
 * 1. Riarmo. Il minimo si ricalcola ogni giorno, quindi un titolo che
 *    resta nella fascia scatenerebbe una notifica al giorno. Dopo il
 *    primo avviso lo stato passa ad 'armed' e non si ripete finche' il
 *    prezzo non risale sopra rearm_pct.
 *
 * 2. Esclusione dei crolli. Un titolo in caduta libera e' vicino al
 *    proprio minimo per definizione: e' il minimo che insegue lui. Il
 *    filtro maxDrop30d scarta chi ha perso troppo nell'ultimo mese, che
 *    non e' un titolo "in saldo" ma un titolo in difficolta'.
 */

import type { OHLCV } from './yahoo';

export type AutoAlertRule = {
  id: string;
  user_id: string;
  name: string | null;
  market: string;
  lookback_days: number;
  threshold_pct: number;
  rearm_pct: number;
  max_drop_30d_pct: number;
  active: boolean;
  notify_telegram: boolean;
};

export type RuleEvaluation = {
  ticker: string;
  price: number;
  periodLow: number;
  periodHigh: number;
  threshold: number;
  pctAboveLow: number;
  dropFromHighPct: number;
  drop30dPct: number;
  /** dentro la fascia: prezzo <= minimo * (1 + threshold_pct/100) */
  inZone: boolean;
  /** sopra la soglia di riarmo: prezzo > minimo * (1 + rearm_pct/100) */
  aboveRearm: boolean;
  /** scartato perche' in forte discesa recente */
  excludedFreefall: boolean;
};

/**
 * Valuta un singolo titolo rispetto a una regola.
 * Ritorna null se non ci sono abbastanza candele per la finestra.
 */
export function evaluateRuleForTicker(
  ticker: string,
  candles: OHLCV[],
  rule: Pick<
    AutoAlertRule,
    'lookback_days' | 'threshold_pct' | 'rearm_pct' | 'max_drop_30d_pct'
  >
): RuleEvaluation | null {
  // Serve almeno il 60% della finestra richiesta, altrimenti il minimo
  // non e' rappresentativo
  const minBars = Math.floor(rule.lookback_days * 0.6);
  if (candles.length < minBars) return null;

  const window = candles.slice(-rule.lookback_days);
  const price = candles[candles.length - 1].c;
  if (!price || !Number.isFinite(price)) return null;

  const periodLow = Math.min(...window.map((c) => c.l));
  const periodHigh = Math.max(...window.map((c) => c.h));
  if (!periodLow || !Number.isFinite(periodLow) || periodLow <= 0) return null;

  const threshold = periodLow * (1 + rule.threshold_pct / 100);
  const rearmLevel = periodLow * (1 + rule.rearm_pct / 100);

  const pctAboveLow = ((price - periodLow) / periodLow) * 100;
  const dropFromHighPct =
    periodHigh > 0 ? ((periodHigh - price) / periodHigh) * 100 : 0;

  // Variazione sugli ultimi ~30 giorni di borsa
  const idx30 = Math.max(0, candles.length - 1 - 21);
  const price30 = candles[idx30].c;
  const drop30dPct =
    price30 > 0 ? ((price30 - price) / price30) * 100 : 0;

  return {
    ticker,
    price,
    periodLow,
    periodHigh,
    threshold,
    pctAboveLow,
    dropFromHighPct,
    drop30dPct,
    inZone: price <= threshold,
    aboveRearm: price > rearmLevel,
    excludedFreefall: drop30dPct > rule.max_drop_30d_pct,
  };
}

/** Riga di testo per la notifica Telegram. */
export function formatAutoAlertLine(e: RuleEvaluation): string {
  return (
    `${e.ticker} · ${e.price.toFixed(2)} · ` +
    `+${e.pctAboveLow.toFixed(1)}% dal minimo ${e.periodLow.toFixed(2)} · ` +
    `−${e.dropFromHighPct.toFixed(0)}% dal massimo`
  );
}
