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
 * Quote arricchito. Nella versione attuale gli endpoint Yahoo
 * quoteSummary e search sono bloccati da IP cloud (403 Host not in
 * allowlist), quindi ritorniamo solo i campi base da yahooQuote +
 * il nome completo dal dizionario locale TICKER_NAMES.
 *
 * I campi di fondamentali (marketCap, peRatio, ecc.) sono dichiarati
 * per compatibilità futura ma restano undefined. Il client nasconde la
 * card Fondamentali se tutti questi campi sono assenti.
 */
export type YahooQuoteFull = {
  ticker: string;
  price: number;
  previousClose: number;
  changePct: number;
  currency?: string;
  exchange?: string;
  longName?: string;
  shortName?: string;
  marketCap?: number;
  peRatio?: number;
  dividendYield?: number;
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

  // Import dinamico per evitare circular deps (ticker-names è side-effect free).
  const { TICKER_NAMES } = await import('./ticker-names');
  const longName = TICKER_NAMES[ticker] ?? TICKER_NAMES[ticker.toUpperCase()];

  return {
    ...base,
    longName,
  };
}

// ============================================================================
// SESSIONI ESTESE (pre-market e after-hours)
// ============================================================================

/**
 * Quotazione nelle sessioni fuori orario.
 *
 * Yahoo non espone dai datacenter l'endpoint screener con le classifiche
 * gia' pronte, ma /v8/finance/chart/ con includePrePost=true restituisce
 * nel blocco meta i prezzi delle sessioni estese: le classifiche le
 * calcoliamo noi.
 *
 * Il pre-market USA va dalle 4:00 alle 9:30 ET, l'after-hours dalle
 * 16:00 alle 20:00 ET. Fuori da queste finestre i campi sono assenti e
 * la funzione ritorna session 'none'.
 */
export type ExtendedQuote = {
  ticker: string;
  session: 'pre' | 'post' | 'regular' | 'none';
  /** Prezzo della sessione estesa, o l'ultimo regolare se non disponibile */
  price: number;
  /** Riferimento su cui e' calcolata la variazione */
  previousClose: number;
  changePct: number;
  /** Volume scambiato nella sessione estesa, quando disponibile */
  extendedVolume: number | null;
  currency?: string;
  exchangeName?: string;
  /** Momento del dato, secondi unix */
  quoteTime: number | null;
};

type ChartMetaExtended = {
  currency?: string;
  fullExchangeName?: string;
  exchangeName?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
  preMarketTime?: number;
  postMarketPrice?: number;
  postMarketChangePercent?: number;
  postMarketTime?: number;
};

export async function yahooExtendedQuote(
  ticker: string,
  timeoutMs = 12000
): Promise<ExtendedQuote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=1d&interval=5m&includePrePost=true`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;

    const json = JSON.parse(text) as {
      chart?: {
        result?: Array<{
          meta?: ChartMetaExtended;
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ volume?: (number | null)[] }>;
          };
        }>;
      };
    };

    const r = json?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;

    const regular = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    if (regular == null || prevClose == null || prevClose <= 0) return null;

    // Il pre-market si confronta con la chiusura regolare precedente;
    // l'after-hours con la chiusura di oggi.
    if (meta.preMarketPrice != null && meta.preMarketPrice > 0) {
      const base = regular;
      return {
        ticker,
        session: 'pre',
        price: meta.preMarketPrice,
        previousClose: base,
        changePct:
          meta.preMarketChangePercent != null
            ? meta.preMarketChangePercent
            : ((meta.preMarketPrice - base) / base) * 100,
        extendedVolume: extendedVolume(r, meta.regularMarketTime),
        currency: meta.currency,
        exchangeName: meta.fullExchangeName ?? meta.exchangeName,
        quoteTime: meta.preMarketTime ?? null,
      };
    }

    if (meta.postMarketPrice != null && meta.postMarketPrice > 0) {
      return {
        ticker,
        session: 'post',
        price: meta.postMarketPrice,
        previousClose: regular,
        changePct:
          meta.postMarketChangePercent != null
            ? meta.postMarketChangePercent
            : ((meta.postMarketPrice - regular) / regular) * 100,
        extendedVolume: extendedVolume(r, meta.regularMarketTime),
        currency: meta.currency,
        exchangeName: meta.fullExchangeName ?? meta.exchangeName,
        quoteTime: meta.postMarketTime ?? null,
      };
    }

    // Nessuna sessione estesa in corso: ritorno il dato regolare
    return {
      ticker,
      session: 'regular',
      price: regular,
      previousClose: prevClose,
      changePct: ((regular - prevClose) / prevClose) * 100,
      extendedVolume: null,
      currency: meta.currency,
      exchangeName: meta.fullExchangeName ?? meta.exchangeName,
      quoteTime: meta.regularMarketTime ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Somma il volume delle candele successive alla chiusura regolare. */
function extendedVolume(
  r: {
    timestamp?: number[];
    indicators?: { quote?: Array<{ volume?: (number | null)[] }> };
  },
  regularMarketTime?: number
): number | null {
  const ts = r.timestamp;
  const vols = r.indicators?.quote?.[0]?.volume;
  if (!ts || !vols || ts.length !== vols.length) return null;

  let total = 0;
  let seen = false;
  for (let i = 0; i < ts.length; i++) {
    const v = vols[i];
    if (v == null) continue;
    // Se conosco l'orario di chiusura regolare conto solo il dopo,
    // altrimenti sommo tutto quello disponibile.
    if (regularMarketTime != null && ts[i] <= regularMarketTime) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

/** Versione parallela con concorrenza limitata. */
export async function yahooExtendedQuoteMany(
  tickers: readonly string[],
  concurrency = 8
): Promise<Record<string, ExtendedQuote>> {
  const out: Record<string, ExtendedQuote> = {};
  let idx = 0;
  async function worker() {
    while (idx < tickers.length) {
      const i = idx++;
      const t = tickers[i];
      const q = await yahooExtendedQuote(t);
      if (q) out[t] = q;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tickers.length) }, worker)
  );
  return out;
}
