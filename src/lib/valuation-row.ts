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

  // Le due fonti vanno distinte anche negli errori: sapere quale delle
  // due ha ceduto e' meta' della diagnosi
  if (secEntry) {
    try {
      f = await fetchFundamentals(ticker, secEntry.cik, candles);
    } catch (e) {
      throw new Error(
        `bilanci SEC: ${e instanceof Error ? e.message : 'errore'}`
      );
    }
  }

  if (!f) {
    let y: Awaited<ReturnType<typeof fetchFundamentalsYahoo>>;
    try {
      y = await fetchFundamentalsYahoo(ticker, candles);
    } catch (e) {
      throw new Error(
        `bilanci Yahoo: ${e instanceof Error ? e.message : 'errore'}`
      );
    }
    if (!y.ok) return { ok: false, reason: y.reason };
    f = y.f;
    source = 'yahoo';
    yahooDebug = y.debug;
  }

  let v: ReturnType<typeof buildVerdict>;
  try {
    v = buildVerdict(f);
  } catch (e) {
    throw new Error(`giudizio: ${e instanceof Error ? e.message : 'errore'}`);
  }

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

/**
 * Messaggio leggibile per gli errori di salvataggio piu' comuni.
 *
 * Il testo originale resta sempre in coda: un suggerimento che copre
 * l'errore vero fa perdere piu' tempo di quanto ne faccia risparmiare,
 * soprattutto quando il suggerimento e' sbagliato.
 */
export function valuationDbErrorMessage(message: string): string {
  // "schema cache" significa che nel database la colonna c'e' ma il
  // livello API non l'ha ancora vista: rifare la migration non serve
  if (/schema cache/i.test(message)) {
    return `Supabase non ha ancora ricaricato lo schema. Esegui: notify pgrst, 'reload schema'; oppure riavvia il progetto. Errore: ${message}`;
  }
  if (/column .* does not exist/i.test(message)) {
    return `Colonna mancante in 'valuations': verifica le migration 015 e 017. Errore: ${message}`;
  }
  if (/relation .* does not exist/i.test(message)) {
    return `Tabella mancante: verifica le migration. Errore: ${message}`;
  }
  if (/row-level security|violates row-level/i.test(message)) {
    return `Scrittura rifiutata dalle regole di accesso: probabilmente manca la chiave di servizio fra le variabili d'ambiente. Errore: ${message}`;
  }
  return message;
}
