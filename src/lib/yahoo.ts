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
  tickers: string[],
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
