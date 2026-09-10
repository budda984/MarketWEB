/**
 * Quotazioni a lotti e classifiche pronte di Yahoo.
 *
 * Tutti questi endpoint vogliono la sessione cookie+crumb.
 *
 *  - v7/finance/quote: fino a qualche centinaio di titoli per richiesta,
 *    con i prezzi di pre-market e after-hours gia' calcolati. Sostituisce
 *    la ricostruzione dalle candele a 5 minuti, che costava una richiesta
 *    per titolo.
 *  - screener predefiniti (day_gainers, day_losers, most_actives): le
 *    classifiche della pagina Yahoo, su tutto il mercato USA. Sono
 *    ordinate sulla sessione regolare: Yahoo non ne ha una per il
 *    pre-market.
 *  - trending: i titoli piu' cercati del momento.
 */

import { yahooAuthedFetch } from './yahoo';

export type BatchQuote = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchangeName: string | null;
  /** PREPRE, PRE, REGULAR, POST, POSTPOST, CLOSED */
  marketState: string | null;
  marketCap: number | null;
  regularMarketPrice: number | null;
  regularMarketPreviousClose: number | null;
  /** Percentuale: 1.5 = +1,5% */
  regularMarketChangePercent: number | null;
  regularMarketVolume: number | null;
  regularMarketTime: number | null;
  averageVolume3m: number | null;
  preMarketPrice: number | null;
  preMarketChangePercent: number | null;
  preMarketTime: number | null;
  postMarketPrice: number | null;
  postMarketChangePercent: number | null;
  postMarketTime: number | null;
};

const QUOTE_FIELDS = [
  'symbol',
  'shortName',
  'longName',
  'currency',
  'fullExchangeName',
  'marketState',
  'marketCap',
  'regularMarketPrice',
  'regularMarketPreviousClose',
  'regularMarketChangePercent',
  'regularMarketVolume',
  'regularMarketTime',
  'averageDailyVolume3Month',
  'preMarketPrice',
  'preMarketChangePercent',
  'preMarketTime',
  'postMarketPrice',
  'postMarketChangePercent',
  'postMarketTime',
];

function n(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'raw' in v) {
    const r = (v as { raw: unknown }).raw;
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  }
  return null;
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** I tempi arrivano in secondi unix; qualche risposta li da' in ISO */
function unixSec(v: unknown): number | null {
  const x = n(v);
  if (x != null) return x > 1e12 ? Math.floor(x / 1000) : x;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
}

function toBatchQuote(r: Record<string, unknown>): BatchQuote | null {
  const symbol = s(r.symbol);
  if (!symbol) return null;
  return {
    symbol: symbol.toUpperCase(),
    name: s(r.longName) ?? s(r.shortName),
    currency: s(r.currency),
    exchangeName: s(r.fullExchangeName),
    marketState: s(r.marketState),
    marketCap: n(r.marketCap),
    regularMarketPrice: n(r.regularMarketPrice),
    regularMarketPreviousClose: n(r.regularMarketPreviousClose),
    regularMarketChangePercent: n(r.regularMarketChangePercent),
    regularMarketVolume: n(r.regularMarketVolume),
    regularMarketTime: unixSec(r.regularMarketTime),
    averageVolume3m: n(r.averageDailyVolume3Month),
    preMarketPrice: n(r.preMarketPrice),
    preMarketChangePercent: n(r.preMarketChangePercent),
    preMarketTime: unixSec(r.preMarketTime),
    postMarketPrice: n(r.postMarketPrice),
    postMarketChangePercent: n(r.postMarketChangePercent),
    postMarketTime: unixSec(r.postMarketTime),
  };
}

/**
 * Quotazioni di molti titoli con poche richieste.
 *
 * Restituisce null solo se nessun lotto e' andato a buon fine: e' il
 * segnale per il chiamante di ripiegare sul metodo delle candele.
 */
export async function yahooQuoteBatch(
  symbols: readonly string[],
  chunkSize = 150
): Promise<Record<string, BatchQuote> | null> {
  const unique = Array.from(new Set(symbols.map((x) => x.toUpperCase())));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }

  const out: Record<string, BatchQuote> = {};
  let anyOk = false;

  // Tre lotti alla volta: bastano per l'universo intero in un paio di
  // secondi senza sembrare un attacco
  let idx = 0;
  async function worker() {
    while (idx < chunks.length) {
      const chunk = chunks[idx++];
      const res = await yahooAuthedFetch(
        (crumb) =>
          `https://query1.finance.yahoo.com/v7/finance/quote` +
          `?symbols=${chunk.map(encodeURIComponent).join(',')}` +
          `&fields=${QUOTE_FIELDS.join(',')}` +
          `&formatted=false&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
        {},
        12000
      );
      if (!res || !res.ok) continue;
      try {
        const json = await res.json();
        const list: Record<string, unknown>[] = json?.quoteResponse?.result ?? [];
        anyOk = true;
        for (const r of list) {
          const q = toBatchQuote(r);
          if (q) out[q.symbol] = q;
        }
      } catch {
        // lotto illeggibile: si va avanti con gli altri
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(3, chunks.length) }, worker)
  );

  return anyOk ? out : null;
}

export type PredefinedScreen = 'day_gainers' | 'day_losers' | 'most_actives';

/** Classifica pronta di Yahoo su tutto il mercato USA */
export async function yahooPredefinedScreen(
  id: PredefinedScreen,
  count = 50
): Promise<BatchQuote[] | null> {
  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved` +
      `?scrIds=${id}&count=${count}&formatted=false` +
      `&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
    {},
    10000
  );
  if (!res || !res.ok) return null;
  try {
    const json = await res.json();
    const list: Record<string, unknown>[] =
      json?.finance?.result?.[0]?.quotes ?? [];
    return list
      .map(toBatchQuote)
      .filter((q): q is BatchQuote => q != null);
  } catch {
    return null;
  }
}

/** Simboli piu' cercati in questo momento sul mercato USA */
export async function yahooTrending(count = 30): Promise<string[]> {
  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query1.finance.yahoo.com/v1/finance/trending/US` +
      `?count=${count}&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
    {},
    8000
  );
  if (!res || !res.ok) return [];
  try {
    const json = await res.json();
    const list: Array<{ symbol?: string }> =
      json?.finance?.result?.[0]?.quotes ?? [];
    return list
      .map((q) => q.symbol?.toUpperCase())
      .filter((x): x is string => Boolean(x));
  } catch {
    return [];
  }
}
