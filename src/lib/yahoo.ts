/**
 * Yahoo Finance API client (no third-party libraries).
 * Port di yahoo_download() dal desktop app Python.
 *
 * Endpoint: https://query1.finance.yahoo.com/v8/finance/chart/{ticker}
 */

import { sessionOfTimestamp } from './market-hours';

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
      exchange: meta.fullExchangeName ?? meta.exchangeName,
      // Il grafico riporta anche il nome: serve per i titoli fuori
      // dall'universo, che non sono nel dizionario locale.
      longName: meta.longName,
      shortName: meta.shortName,
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
        fullExchangeName?: string;
        longName?: string;
        shortName?: string;
        instrumentType?: string;
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
  const longName =
    TICKER_NAMES[ticker] ??
    TICKER_NAMES[ticker.toUpperCase()] ??
    base.longName ??
    base.shortName;

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
  /** Eta' del dato in secondi al momento della lettura */
  ageSec: number | null;
  /** Momento dell'ultimo scambio nella sessione regolare */
  regularMarketTime: number | null;
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
  // range=2d per essere certi di avere sia l'ultima sessione regolare
  // chiusa sia le barre estese successive. includePrePost=true fa
  // includere le candele fuori orario.
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=2d&interval=5m&includePrePost=true`;

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
            quote?: Array<{
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };

    const r = json?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;

    const regular = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    if (regular == null || regular <= 0) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    const regTime = meta.regularMarketTime ?? 0;

    // LA SESSIONE ESTESA SI RICAVA DALLE CANDELE.
    //
    // Il blocco meta di /v8/finance/chart/ non espone preMarketPrice:
    // quei campi appartengono agli endpoint quote, che dai datacenter
    // rispondono 403. Con includePrePost=true, pero', le barre fuori
    // orario sono presenti nell'array timestamp: l'ultima chiusura
    // valida successiva all'ultimo scambio regolare E' il prezzo della
    // sessione estesa.
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const vols = r?.indicators?.quote?.[0]?.volume ?? [];

    let extPrice: number | null = null;
    let extTime: number | null = null;
    let extVol = 0;
    let extVolSeen = false;

    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i];
      if (t == null || t <= regTime) break; // arrivati alla sessione regolare
      const c = closes[i];
      const v = vols[i];
      if (v != null && v > 0) {
        extVol += v;
        extVolSeen = true;
      }
      // La prima chiusura valida partendo dal fondo e' il prezzo corrente
      if (extPrice == null && c != null && Number.isFinite(c) && c > 0) {
        extPrice = c;
        extTime = t;
      }
    }

    const MAX_AGE_SEC = 12 * 3600;
    const extUsable =
      extPrice != null &&
      extTime != null &&
      nowSec - extTime < MAX_AGE_SEC;

    if (extUsable) {
      const kind = sessionOfTimestamp(extTime!);
      if (kind === 'pre' || kind === 'post') {
        return {
          ticker,
          session: kind,
          price: extPrice!,
          previousClose: regular,
          changePct: ((extPrice! - regular) / regular) * 100,
          extendedVolume: extVolSeen ? extVol : null,
          currency: meta.currency,
          exchangeName: meta.fullExchangeName ?? meta.exchangeName,
          quoteTime: extTime,
          ageSec: nowSec - extTime!,
          regularMarketTime: meta.regularMarketTime ?? null,
        };
      }
    }

    // Nessuna barra estesa utilizzabile: dato della sessione regolare
    if (prevClose == null || prevClose <= 0) return null;
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
      ageSec: regTime ? nowSec - regTime : null,
      regularMarketTime: meta.regularMarketTime ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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


// ============================================================================
// SESSIONE YAHOO (cookie + crumb)
// ============================================================================

/**
 * Diversi endpoint Yahoo non sono bloccati per indirizzo ma richiedono
 * una sessione: un cookie di consenso e un "crumb", cioe' un token
 * legato a quel cookie. Senza, rispondono 401 "Invalid Crumb".
 *
 * La procedura e' in due passaggi: si ottiene il cookie visitando un
 * dominio Yahoo, poi si chiede il crumb presentando quel cookie. I due
 * vanno poi usati insieme a ogni richiesta.
 *
 * La sessione si conserva in memoria perche' ottenerla costa due
 * richieste: rifarla ogni volta triplicherebbe il traffico.
 */
type YahooSession = { cookie: string; crumb: string; at: number };

let sessionCache: YahooSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;

// Richiesta di sessione in corso: le chiamate che arrivano nel frattempo
// aspettano questa invece di aprirne un'altra. Senza, una pagina che
// lancia dieci richieste insieme a freddo farebbe dieci giri cookie+crumb.
let sessionInFlight: Promise<YahooSession | null> | null = null;

// Dopo un fallimento si aspetta un po' prima di riprovare, per non
// martellare Yahoo quando il problema non si risolve da solo.
let sessionFailedAt = 0;
const SESSION_RETRY_PAUSE_MS = 30 * 1000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function getYahooSession(
  force = false
): Promise<YahooSession | null> {
  if (!force && sessionCache && Date.now() - sessionCache.at < SESSION_TTL_MS) {
    return sessionCache;
  }
  if (sessionInFlight) return sessionInFlight;
  if (!force && Date.now() - sessionFailedAt < SESSION_RETRY_PAUSE_MS) {
    return null;
  }

  sessionInFlight = createYahooSession().finally(() => {
    sessionInFlight = null;
  });
  return sessionInFlight;
}

async function createYahooSession(): Promise<YahooSession | null> {
  try {
    // 1. Cookie. fc.yahoo.com risponde spesso con un errore, ma i
    //    cookie li imposta lo stesso: quello che conta e' l'intestazione.
    let cookie = '';
    for (const seed of [
      'https://fc.yahoo.com/',
      'https://finance.yahoo.com/',
    ]) {
      try {
        const res = await fetch(seed, {
          headers: { 'User-Agent': BROWSER_UA },
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        const jar = res.headers.getSetCookie?.() ?? [];
        const parts = jar
          .map((c) => c.split(';')[0])
          .filter((c) => /^(A1|A3|A1S|GUC|B)=/.test(c));
        if (parts.length > 0) {
          cookie = parts.join('; ');
          break;
        }
      } catch {
        // il prossimo dominio
      }
    }
    if (!cookie) {
      sessionFailedAt = Date.now();
      return null;
    }

    // 2. Crumb, presentando il cookie appena ottenuto
    const crumbRes = await fetch(
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/plain, */*',
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!crumbRes.ok) {
      sessionFailedAt = Date.now();
      return null;
    }
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 40 || crumb.includes('<')) {
      sessionFailedAt = Date.now();
      return null;
    }

    sessionCache = { cookie, crumb, at: Date.now() };
    sessionFailedAt = 0;
    return sessionCache;
  } catch {
    sessionFailedAt = Date.now();
    return null;
  }
}

/**
 * Richiesta autenticata a Yahoo. Se la sessione e' scaduta, la rinnova
 * una volta sola e riprova: un secondo fallimento significa che il
 * problema non e' la sessione.
 */
export async function yahooAuthedFetch(
  buildUrl: (crumb: string) => string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response | null> {
  let session = await getYahooSession();
  if (!session) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(buildUrl(session.crumb), {
        ...init,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json',
          Cookie: session.cookie,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401 && attempt === 0) {
        // Crumb scaduto. Si butta la sessione solo se e' ancora quella
        // usata: se un'altra richiesta l'ha gia' rinnovata, si riusa la
        // nuova invece di rifarla.
        if (sessionCache === session) sessionCache = null;
        const next = await getYahooSession(sessionCache == null);
        if (!next) return null;
        session = next;
        continue;
      }
      return res;
    } catch {
      return null;
    }
  }
  return null;
}

// ============================================================================
// RICERCA DEI TITOLI
// ============================================================================

/**
 * Ricerca per nome o simbolo su tutto il catalogo Yahoo, non solo sui
 * titoli dell'universo. E' la stessa che alimenta la casella di ricerca
 * del sito Yahoo, e dai datacenter funziona solo con la sessione.
 */
export type YahooSearchResult = {
  symbol: string;
  name: string;
  /** Codice breve della borsa (NMS, MIL, GER...) */
  exchange: string | null;
  /** Nome leggibile della borsa (NASDAQ, Milan, XETRA...) */
  exchangeName: string | null;
  /** EQUITY, ETF, INDEX, CRYPTOCURRENCY, CURRENCY, FUTURE, MUTUALFUND */
  type: string | null;
  sector: string | null;
  industry: string | null;
};

// Opzioni e simili non hanno un grafico utile: si scartano.
const SEARCH_TYPES_EXCLUDED = new Set(['OPTION', 'MONEYMARKET']);

export async function yahooSearch(
  query: string,
  count = 10
): Promise<YahooSearchResult[] | null> {
  const q = query.trim();
  if (!q) return [];

  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query2.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}` +
      `&quotesCount=${count}&newsCount=0&listsCount=0` +
      `&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query` +
      `&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`,
    {},
    8000
  );
  if (!res || !res.ok) return null;

  try {
    const json = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        exchDisp?: string;
        quoteType?: string;
        sector?: string;
        sectorDisp?: string;
        industry?: string;
        industryDisp?: string;
        isYahooFinance?: boolean;
      }>;
    };

    const out: YahooSearchResult[] = [];
    const seen = new Set<string>();
    for (const r of json.quotes ?? []) {
      // Nella lista possono comparire voci che non sono titoli
      // (pagine, persone): si tengono solo quelle con un simbolo.
      if (!r.symbol || r.isYahooFinance === false) continue;
      const type = r.quoteType?.toUpperCase() ?? null;
      if (type && SEARCH_TYPES_EXCLUDED.has(type)) continue;
      const symbol = r.symbol.toUpperCase();
      if (seen.has(symbol)) continue;
      // Rumore frequente nei risultati:
      //  - i veri indici Yahoo iniziano con ^; gli altri "INDEX" sono
      //    prodotti strutturati (certificati svizzeri e simili);
      //  - .XC e' Cboe Europe, un duplicato della quotazione principale
      //    con dati scarsi.
      if (type === 'INDEX' && !symbol.startsWith('^')) continue;
      if (symbol.endsWith('.XC')) continue;
      seen.add(symbol);
      out.push({
        symbol,
        name: r.longname || r.shortname || symbol,
        exchange: r.exchange ?? null,
        exchangeName: r.exchDisp ?? null,
        type,
        sector: r.sectorDisp ?? r.sector ?? null,
        industry: r.industryDisp ?? r.industry ?? null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

// ============================================================================
// CALENDARIO DELLE TRIMESTRALI
// ============================================================================

/**
 * Date di pubblicazione annunciate dalle societa'.
 *
 * L'endpoint e' quello che alimenta la pagina delle trimestrali di
 * Yahoo: vuole una POST con un filtro, e la sessione con crumb.
 * Sostituisce le stime ricavate dalla cadenza dei depositi, che erano
 * un ripiego.
 */
export type EarningsEvent = {
  ticker: string;
  companyName: string | null;
  /** Momento della pubblicazione, ISO */
  dateTime: string;
  /** Prima dell'apertura, dopo la chiusura, o durante */
  timing: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
};

export async function fetchEarningsCalendar(
  fromDate: string,
  toDate: string,
  size = 250,
  offset = 0
): Promise<{ events: EarningsEvent[]; total: number } | null> {
  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query1.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size,
        offset,
        sortField: 'startdatetime',
        sortType: 'ASC',
        entityIdType: 'earnings',
        includeFields: [
          'ticker',
          'companyshortname',
          'startdatetime',
          'startdatetimetype',
          'epsestimate',
          'epsactual',
          'epssurprisepct',
        ],
        query: {
          operator: 'and',
          operands: [
            { operator: 'gte', operands: ['startdatetime', fromDate] },
            { operator: 'lt', operands: ['startdatetime', toDate] },
          ],
        },
      }),
    },
    20000
  );

  if (!res || !res.ok) return null;

  try {
    const json = await res.json();
    const doc = json?.finance?.result?.[0]?.documents?.[0];
    if (!doc) return { events: [], total: 0 };

    const cols: string[] = (doc.columns ?? []).map(
      (c: { id?: string }) => c.id ?? ''
    );
    const rows: unknown[][] = doc.rows ?? [];
    const idx = (name: string) => cols.indexOf(name);

    const iTicker = idx('ticker');
    const iName = idx('companyshortname');
    const iWhen = idx('startdatetime');
    const iType = idx('startdatetimetype');
    const iEst = idx('epsestimate');
    const iAct = idx('epsactual');
    const iSur = idx('epssurprisepct');

    const num = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const events: EarningsEvent[] = [];
    for (const r of rows) {
      const tk = iTicker >= 0 ? String(r[iTicker] ?? '') : '';
      const when = iWhen >= 0 ? String(r[iWhen] ?? '') : '';
      if (!tk || !when) continue;
      events.push({
        ticker: tk.toUpperCase(),
        companyName: iName >= 0 ? (r[iName] as string) ?? null : null,
        dateTime: when,
        timing: iType >= 0 ? (r[iType] as string) ?? null : null,
        epsEstimate: iEst >= 0 ? num(r[iEst]) : null,
        epsActual: iAct >= 0 ? num(r[iAct]) : null,
        surprisePct: iSur >= 0 ? num(r[iSur]) : null,
      });
    }

    return { events, total: Number(doc.total ?? events.length) };
  } catch {
    return null;
  }
}
