/**
 * Yahoo Finance API client (no third-party libraries).
 * Port di yahoo_download() dal desktop app Python.
 *
 * Endpoint: https://query1.finance.yahoo.com/v8/finance/chart/{ticker}
 */

export type OHLCV = {
  t: number; // timestamp (unix seconds)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max';
export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Scarica candele storiche per un ticker.
 */
export async function yahooDownload(
  ticker: string,
  period: Period = '3mo',
  interval: Interval = '1d',
  timeoutMs = 15000
): Promise<OHLCV[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${period}&interval=${interval}&includePrePost=false&events=div,splits`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`yahoo ${ticker} HTTP ${res.status}`);

    const json = (await res.json()) as YahooChartResponse;
    const result = json?.chart?.result?.[0];
    if (!result) return [];

    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    if (!q) return [];

    const out: OHLCV[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const v = q.volume?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ t: ts[i], o, h, l, c, v: v ?? 0 });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quote istantaneo (ultimo prezzo + variazione giornaliera).
 */
export async function yahooQuote(ticker: string, timeoutMs = 10000) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=5d&interval=1d`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChartResponse;
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || prev == null) return null;
    return {
      ticker,
      price,
      previousClose: prev,
      changePct: ((price - prev) / prev) * 100,
      currency: meta.currency,
      exchange: meta.exchangeName,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download parallelo con concorrenza limitata.
 */
export async function yahooDownloadMany(
  tickers: readonly string[],
  period: Period = '3mo',
  interval: Interval = '1d',
  concurrency = 10
): Promise<Record<string, OHLCV[]>> {
  const results: Record<string, OHLCV[]> = {};
  let idx = 0;

  async function worker() {
    while (idx < tickers.length) {
      const my = idx++;
      const t = tickers[my];
      try {
        results[t] = await yahooDownload(t, period, interval);
      } catch {
        results[t] = [];
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tickers.length) }, () => worker())
  );
  return results;
}

// ============================================================================
// Yahoo Finance response types
// ============================================================================

type YahooChartResponse = {
  chart: {
    result: Array<{
      meta: {
        currency?: string;
        exchangeName?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        symbol: string;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error: null | { code: string; description: string };
  };
};

/**
 * Quote arricchito con info economiche: nome completo, market cap,
 * P/E, dividend yield, 52-week high/low.
 *
 * Usa l'endpoint quoteSummary di Yahoo. Se l'endpoint fallisce,
 * ritorna solo i campi base da yahooQuote.
 */
export type YahooQuoteFull = {
  ticker: string;
  price: number;
  previousClose: number;
  changePct: number;
  currency?: string;
  exchange?: string;
  // Info economiche (opzionali, potrebbero mancare per forex/crypto)
  longName?: string;
  shortName?: string;
  marketCap?: number;
  peRatio?: number;
  dividendYield?: number; // frazione es. 0.025 = 2.5%
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  sector?: string;
  industry?: string;
};

export async function yahooQuoteFull(
  ticker: string,
  timeoutMs = 12000
): Promise<YahooQuoteFull | null> {
  const base = await yahooQuote(ticker, timeoutMs);
  if (!base) return null;

  // Tento quoteSummary per il dettaglio. Fallback silenzioso se fallisce.
  const modules = [
    'price',
    'summaryDetail',
    'defaultKeyStatistics',
    'assetProfile',
  ].join(',');
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=${modules}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return base;

    type SummaryResult = {
      quoteSummary?: {
        result?: Array<{
          price?: { longName?: string; shortName?: string };
          summaryDetail?: {
            marketCap?: { raw?: number };
            trailingPE?: { raw?: number };
            dividendYield?: { raw?: number };
            fiftyTwoWeekHigh?: { raw?: number };
            fiftyTwoWeekLow?: { raw?: number };
          };
          assetProfile?: { sector?: string; industry?: string };
        }>;
      };
    };
    const json = (await res.json()) as SummaryResult;
    const r = json?.quoteSummary?.result?.[0];
    if (!r) return base;

    return {
      ...base,
      longName: r.price?.longName,
      shortName: r.price?.shortName,
      marketCap: r.summaryDetail?.marketCap?.raw,
      peRatio: r.summaryDetail?.trailingPE?.raw,
      dividendYield: r.summaryDetail?.dividendYield?.raw,
      fiftyTwoWeekHigh: r.summaryDetail?.fiftyTwoWeekHigh?.raw,
      fiftyTwoWeekLow: r.summaryDetail?.fiftyTwoWeekLow?.raw,
      sector: r.assetProfile?.sector,
      industry: r.assetProfile?.industry,
    };
  } catch {
    return base;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ricerca libera: trova ticker a partire dal nome.
 * Es. "apple" → [{ticker: "AAPL", name: "Apple Inc.", exchange: "NMS"}, ...]
 */
export type YahooSearchResult = {
  ticker: string;
  name: string;
  exchange?: string;
  type?: string; // EQUITY, ETF, CRYPTOCURRENCY, ecc.
};

export async function yahooSearch(
  query: string,
  limit = 8,
  timeoutMs = 8000
): Promise<YahooSearchResult[]> {
  if (!query || query.trim().length < 1) return [];
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
    `&quotesCount=${limit}&newsCount=0`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return [];
    type SearchResponse = {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        quoteType?: string;
      }>;
    };
    const json = (await res.json()) as SearchResponse;
    const quotes = json?.quotes ?? [];
    return quotes
      .filter((q) => q.symbol)
      .map((q) => ({
        ticker: q.symbol!,
        name: q.longname ?? q.shortname ?? q.symbol!,
        exchange: q.exchange,
        type: q.quoteType,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
