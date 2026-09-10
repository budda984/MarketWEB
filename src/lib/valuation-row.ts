/**
 * Una valutazione pronta da salvare, scegliendo la fonte.
 *
 * Prima la SEC, quando il titolo e' nella sua anagrafica: i bilanci
 * depositati sono la fonte piu' completa e controllata. Se la SEC non
 * c'e' (titoli non USA) o non ha le serie us-gaap (societa' estere che
 * depositano in IFRS), si passa a Yahoo con lo stesso metodo.
 */

import type { OHLCV } from './yahoo';
import type { TickerCik } from './sec';
import { fetchFundamentals, buildVerdict, type Fundamentals } from './valuation';
import { fetchFundamentalsYahoo, type YahooValuationDebug } from './valuation-yahoo';

export type ValuationSource = 'sec' | 'yahoo';

export type ValuationBuild =
  | {
      ok: true;
      source: ValuationSource;
      f: Fundamentals;
      row: Record<string, unknown>;
      yahooDebug?: YahooValuationDebug;
    }
  | { ok: false; reason: string };

export async function buildValuation(
  ticker: string,
  candles: OHLCV[],
  secEntry: TickerCik | undefined
): Promise<ValuationBuild> {
  let f: Fundamentals | null = null;
  let source: ValuationSource = 'sec';
  let yahooDebug: YahooValuationDebug | undefined;

  if (secEntry) {
    f = await fetchFundamentals(ticker, secEntry.cik, candles);
  }

  if (!f) {
    const y = await fetchFundamentalsYahoo(ticker, candles);
    if (!y.ok) return { ok: false, reason: y.reason };
    f = y.f;
    source = 'yahoo';
    yahooDebug = y.debug;
  }

  const v = buildVerdict(f);
  const row = {
    ticker,
    price: f.price,
    ttm_eps: f.ttmEps,
    ttm_revenue: f.ttmRevenue,
    eps_growth_pct: f.epsGrowthPct,
    revenue_growth_pct: f.revenueGrowthPct,
    net_margin: f.netMargin,
    margin_change_pct: f.marginChangePct,
    current_pe: f.currentPe,
    median_pe: f.medianPe,
    pe_discount_pct: f.peDiscountPct,
    verdict_level: v.level,
    verdict_headline: v.headline,
    verdict_reasons: v.reasons,
    last_report_date: f.lastReportDate,
    next_report_estimate: f.nextReportEstimate,
    cadence_days: f.cadenceDays,
    quarters_available: f.quartersAvailable,
    source,
    updated_at: new Date().toISOString(),
  };

  return { ok: true, source, f, row, yahooDebug };
}

/** Messaggio leggibile per gli errori di salvataggio piu' comuni */
export function valuationDbErrorMessage(message: string): string {
  if (/source/i.test(message) && /schema cache|column/i.test(message)) {
    return "Manca la colonna 'source' in 'valuations': esegui la migration 017_valuation_source.sql.";
  }
  if (/schema cache|does not exist/i.test(message)) {
    return "La tabella 'valuations' non esiste ancora: esegui la migration 012_valuation.sql.";
  }
  return message;
}
