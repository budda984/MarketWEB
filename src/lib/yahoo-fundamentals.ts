/**
 * Fondamentali da Yahoo: profilo del titolo e serie di bilancio.
 *
 * Due endpoint, entrambi con la sessione cookie+crumb:
 *  - quoteSummary: istantanea del titolo (capitalizzazione, multipli,
 *    dividendo, settore). Alimenta la scheda Fondamentali del grafico.
 *  - fundamentals-timeseries: le voci di bilancio nel tempo (utile per
 *    azione, fatturato, utile netto), trimestrali e annuali. Alimenta le
 *    valutazioni dei titoli che la SEC non copre.
 *
 * Yahoo, gratis, restituisce circa quattro-cinque anni di dati annuali e
 * gli ultimi cinque-sei trimestri: meno della SEC, ma abbastanza per il
 * confronto con la propria storia.
 */

import { yahooAuthedFetch } from './yahoo';

// ============================================================================
// PROFILO (quoteSummary)
// ============================================================================

export type YahooProfile = {
  longName: string | null;
  /** Valuta del prezzo, come la riporta Yahoo (GBp per Londra) */
  currency: string | null;
  /** Valuta in cui l'azienda redige il bilancio */
  financialCurrency: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  /** Frazione: 0.012 = 1,2% */
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  beta: number | null;
  /** Frazioni */
  profitMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
};

const PROFILE_MODULES = [
  'price',
  'summaryDetail',
  'summaryProfile',
  'defaultKeyStatistics',
  'financialData',
];

// Il profilo cambia poco durante la giornata: si tiene in memoria per
// non rifare la richiesta a ogni apertura del grafico
const PROFILE_TTL_MS = 15 * 60 * 1000;
const profileCache = new Map<string, { at: number; p: YahooProfile | null }>();

/** Yahoo restituisce i numeri come valore semplice o come {raw, fmt} */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'raw' in v) {
    const r = (v as { raw: unknown }).raw;
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export async function fetchYahooProfile(
  ticker: string
): Promise<YahooProfile | null> {
  const key = ticker.toUpperCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.p;

  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}` +
      `?modules=${PROFILE_MODULES.join(',')}` +
      `&formatted=false&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
    {},
    8000
  );
  // Un errore di rete non si mette in cache: al prossimo giro si riprova
  if (!res) return null;

  let p: YahooProfile | null = null;
  if (res.ok) {
    try {
      const json = await res.json();
      const r = json?.quoteSummary?.result?.[0];
      if (r) {
        const price = r.price ?? {};
        const sd = r.summaryDetail ?? {};
        const sp = r.summaryProfile ?? {};
        const ks = r.defaultKeyStatistics ?? {};
        const fd = r.financialData ?? {};
        p = {
          longName: str(price.longName) ?? str(price.shortName),
          currency: str(price.currency) ?? str(sd.currency),
          financialCurrency: str(fd.financialCurrency),
          marketCap: num(price.marketCap) ?? num(sd.marketCap),
          trailingPE: num(sd.trailingPE),
          forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
          dividendYield: num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield),
          fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
          fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
          beta: num(sd.beta) ?? num(ks.beta),
          profitMargin: num(fd.profitMargins) ?? num(ks.profitMargins),
          revenueGrowth: num(fd.revenueGrowth),
          earningsGrowth: num(fd.earningsGrowth),
          sector: str(sp.sectorDisp) ?? str(sp.sector),
          industry: str(sp.industryDisp) ?? str(sp.industry),
          country: str(sp.country),
        };
      }
    } catch {
      p = null;
    }
  }

  // Anche l'assenza di dati si ricorda (ETF, crypto): evita di
  // richiederli a ogni apertura
  if (profileCache.size > 500) profileCache.clear();
  profileCache.set(key, { at: Date.now(), p });
  return p;
}

// ============================================================================
// SERIE DI BILANCIO (fundamentals-timeseries)
// ============================================================================

export type SeriesPoint = {
  /** Data di chiusura del periodo contabile, YYYY-MM-DD */
  date: string;
  value: number;
  currency: string | null;
};

export type YahooFinancials = {
  quarterlyEps: SeriesPoint[];
  annualEps: SeriesPoint[];
  /** Utile per azione degli ultimi dodici mesi, ultimo valore */
  trailingEps: SeriesPoint | null;
  quarterlyRevenue: SeriesPoint[];
  annualRevenue: SeriesPoint[];
  quarterlyNetIncome: SeriesPoint[];
  annualNetIncome: SeriesPoint[];
  /** Valuta del bilancio, dalla prima voce che la dichiara */
  currency: string | null;
};

const SERIES_TYPES = [
  'quarterlyDilutedEPS',
  'annualDilutedEPS',
  'trailingDilutedEPS',
  'quarterlyBasicEPS',
  'annualBasicEPS',
  'trailingBasicEPS',
  'quarterlyTotalRevenue',
  'annualTotalRevenue',
  'quarterlyNetIncomeCommonStockholders',
  'annualNetIncomeCommonStockholders',
  'quarterlyNetIncome',
  'annualNetIncome',
];

export async function fetchYahooFinancials(
  ticker: string
): Promise<YahooFinancials | null> {
  const now = Math.floor(Date.now() / 1000);
  // Dieci anni indietro: Yahoo ne restituisce comunque meno, ma cosi'
  // non si taglia nulla di quello che ha
  const from = now - 10 * 365 * 86400;

  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}` +
      `?symbol=${encodeURIComponent(ticker)}` +
      `&type=${SERIES_TYPES.join(',')}` +
      `&period1=${from}&period2=${now + 86400}` +
      `&merge=false&padTimeSeries=false&lang=en-US&region=US` +
      `&crumb=${encodeURIComponent(crumb)}`,
    {},
    10000
  );
  if (!res || !res.ok) return null;

  let json: {
    timeseries?: {
      result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }>;
    };
  };
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const byType = new Map<string, SeriesPoint[]>();
  for (const r of json?.timeseries?.result ?? []) {
    const type = r.meta?.type?.[0];
    if (!type) continue;
    const raw = r[type];
    if (!Array.isArray(raw)) continue;
    const points: SeriesPoint[] = [];
    for (const p of raw as Array<{
      asOfDate?: string;
      currencyCode?: string;
      reportedValue?: unknown;
    } | null>) {
      // L'array ha buchi (null) per i periodi senza dato
      if (!p?.asOfDate) continue;
      const value = num(p.reportedValue);
      if (value == null) continue;
      points.push({
        date: p.asOfDate,
        value,
        currency: str(p.currencyCode),
      });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    byType.set(type, points);
  }

  // Diluito se c'e', altrimenti base; per l'utile, quello di competenza
  // degli azionisti ordinari se c'e'
  const pick = (...types: string[]): SeriesPoint[] => {
    for (const t of types) {
      const s = byType.get(t);
      if (s && s.length > 0) return s;
    }
    return [];
  };

  const quarterlyEps = pick('quarterlyDilutedEPS', 'quarterlyBasicEPS');
  const annualEps = pick('annualDilutedEPS', 'annualBasicEPS');
  const trailing = pick('trailingDilutedEPS', 'trailingBasicEPS');
  const quarterlyRevenue = pick('quarterlyTotalRevenue');
  const annualRevenue = pick('annualTotalRevenue');
  const quarterlyNetIncome = pick(
    'quarterlyNetIncomeCommonStockholders',
    'quarterlyNetIncome'
  );
  const annualNetIncome = pick(
    'annualNetIncomeCommonStockholders',
    'annualNetIncome'
  );

  if (quarterlyEps.length === 0 && annualEps.length === 0) return null;

  const currency =
    [...annualEps, ...quarterlyEps, ...annualRevenue].find((p) => p.currency)
      ?.currency ?? null;

  return {
    quarterlyEps,
    annualEps,
    trailingEps: trailing.length > 0 ? trailing[trailing.length - 1] : null,
    quarterlyRevenue,
    annualRevenue,
    quarterlyNetIncome,
    annualNetIncome,
    currency,
  };
}
