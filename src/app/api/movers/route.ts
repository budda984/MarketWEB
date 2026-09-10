import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooExtendedQuoteMany, type ExtendedQuote } from '@/lib/yahoo';
import {
  yahooQuoteBatch,
  yahooPredefinedScreen,
  yahooTrending,
  type BatchQuote,
} from '@/lib/yahoo-market';
import { MARKETS } from '@/lib/tickers';
import { getMarketSession, type MarketSession } from '@/lib/market-hours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/movers?universe=sp500|nasdaq|both|all&limit=20&minChange=1
 *
 * Tre fonti, in ordine di preferenza:
 *
 *  - classifiche pronte di Yahoo (universe=all, sessione regolare): tutto
 *    il mercato USA gia' ordinato, due richieste;
 *  - quotazioni a lotti: prezzi di pre-market e after-hours gia' pronti,
 *    150 titoli per richiesta;
 *  - candele a 5 minuti titolo per titolo: il metodo di prima, tenuto come
 *    ripiego se la sessione Yahoo non risponde.
 *
 * Yahoo non pubblica una classifica del pre-market. Con universe=all,
 * fuori dalla sessione regolare, l'elenco dei candidati si allarga a
 * S&P 500 e NASDAQ piu' i titoli piu' scambiati, i maggiori rialzi e
 * ribassi della sessione precedente e i piu' cercati.
 */

type Source = 'screener' | 'batch' | 'candles';

// Oltre questa eta' un prezzo esteso e' del giorno prima
const MAX_EXT_AGE_SEC = 12 * 3600;

/** Da quotazione a lotti al formato della vista, secondo la sessione */
function fromBatch(
  q: BatchQuote,
  session: MarketSession,
  nowSec: number
): ExtendedQuote | null {
  const reg = q.regularMarketPrice;
  if (reg == null || reg <= 0) return null;
  const regTime = q.regularMarketTime ?? 0;

  const base = {
    ticker: q.symbol,
    name: q.name,
    currency: q.currency ?? undefined,
    exchangeName: q.exchangeName ?? undefined,
    regularMarketTime: q.regularMarketTime,
    extendedVolume: null,
  };

  // Prezzo esteso valido solo se successivo all'ultimo scambio regolare
  // e recente: altrimenti e' quello della sessione precedente
  const ext =
    session === 'pre'
      ? { price: q.preMarketPrice, time: q.preMarketTime, kind: 'pre' as const }
      : session === 'post'
        ? { price: q.postMarketPrice, time: q.postMarketTime, kind: 'post' as const }
        : null;

  if (
    ext &&
    ext.price != null &&
    ext.price > 0 &&
    ext.time != null &&
    ext.time > regTime &&
    nowSec - ext.time < MAX_EXT_AGE_SEC
  ) {
    return {
      ...base,
      session: ext.kind,
      price: ext.price,
      previousClose: reg,
      changePct: ((ext.price - reg) / reg) * 100,
      quoteTime: ext.time,
      ageSec: nowSec - ext.time,
    };
  }

  const prev = q.regularMarketPreviousClose;
  if (prev == null || prev <= 0) return null;
  return {
    ...base,
    session: 'regular',
    price: reg,
    previousClose: prev,
    changePct: q.regularMarketChangePercent ?? ((reg - prev) / prev) * 100,
    quoteTime: q.regularMarketTime,
    ageSec: regTime ? nowSec - regTime : null,
  };
}

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);

  // Diagnostica: /api/movers?debug=AAPL restituisce la risposta grezza di
  // Yahoo per un solo titolo. Serve a verificare quali campi arrivano
  // davvero, senza dover indovinare.
  const debugTicker = url.searchParams.get('debug');
  if (debugTicker) {
    const t = debugTicker.toUpperCase();
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}` +
        '?range=2d&interval=5m&includePrePost=true',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );
    const status = res.status;
    const body = await res.text();
    if (!res.ok) {
      return NextResponse.json({ debug: t, status, bodyStart: body.slice(0, 300) });
    }
    const j = JSON.parse(body);
    const r0 = j?.chart?.result?.[0];
    const meta = r0?.meta ?? {};
    const ts: number[] = r0?.timestamp ?? [];
    const closes = r0?.indicators?.quote?.[0]?.close ?? [];
    const regTime = meta.regularMarketTime ?? 0;

    const afterRegular = ts
      .map((tt: number, i: number) => ({ t: tt, c: closes[i] }))
      .filter((x: { t: number }) => x.t > regTime)
      .slice(-8)
      .map((x: { t: number; c: number | null }) => ({
        etTime: new Date(x.t * 1000).toLocaleString('en-US', {
          timeZone: 'America/New_York',
        }),
        close: x.c,
      }));

    return NextResponse.json({
      debug: t,
      status,
      metaKeys: Object.keys(meta),
      hasPreMarketPrice: 'preMarketPrice' in meta,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      regularMarketTimeET: regTime
        ? new Date(regTime * 1000).toLocaleString('en-US', {
            timeZone: 'America/New_York',
          })
        : null,
      currentTradingPeriod: meta.currentTradingPeriod ?? null,
      totalCandles: ts.length,
      candlesAfterRegularClose: afterRegular.length,
      lastExtendedCandles: afterRegular,
      serverNowET: new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
      }),
    });
  }

  const universeParam = url.searchParams.get('universe') ?? 'both';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);
  const minChange = Number(url.searchParams.get('minChange') ?? 1);

  const t0 = Date.now();
  const nowSec = Math.floor(Date.now() / 1000);

  // LA SESSIONE SI DEDUCE DALL'OROLOGIO, NON DAI DATI.
  //
  // Contare quanti titoli hanno gia' scambiato per decidere se il
  // pre-market e' aperto porta a dichiararlo chiuso proprio nei primi
  // minuti, quando hanno scambiato in pochi: e' cosi' che la vista
  // finiva per mostrare la chiusura del giorno prima.
  const marketInfo = getMarketSession();
  const extended = marketInfo.session === 'pre' || marketInfo.session === 'post';

  try {
    const sp = (MARKETS['S&P 500'] as readonly string[]) ?? [];
    const nq = (MARKETS['NASDAQ'] as readonly string[]) ?? [];
    let tickers: string[] =
      universeParam === 'sp500'
        ? [...sp]
        : universeParam === 'nasdaq'
          ? [...nq]
          : Array.from(new Set([...sp, ...nq]));

    let all: ExtendedQuote[] = [];
    let source: Source = 'batch';
    let truncated = false;

    // --- 1. Tutto il mercato, sessione regolare: classifiche pronte ----
    if (universeParam === 'all' && !extended) {
      const [up, down] = await Promise.all([
        yahooPredefinedScreen('day_gainers', 50),
        yahooPredefinedScreen('day_losers', 50),
      ]);
      if (up && down) {
        source = 'screener';
        const seen = new Set<string>();
        for (const q of [...up, ...down]) {
          if (seen.has(q.symbol)) continue;
          seen.add(q.symbol);
          const e = fromBatch(q, 'regular', nowSec);
          if (e) all.push(e);
        }
        tickers = Array.from(seen);
      }
    }

    // --- 2. Quotazioni a lotti ----------------------------------------
    if (source !== 'screener') {
      if (universeParam === 'all') {
        // Candidati extra per le sessioni estese: chi si e' mosso o e'
        // stato scambiato di piu' ieri, e chi e' piu' cercato oggi
        const [actives, up, down, trending] = await Promise.all([
          yahooPredefinedScreen('most_actives', 100),
          yahooPredefinedScreen('day_gainers', 100),
          yahooPredefinedScreen('day_losers', 100),
          yahooTrending(30),
        ]);
        const extra = [
          ...(actives ?? []).map((q) => q.symbol),
          ...(up ?? []).map((q) => q.symbol),
          ...(down ?? []).map((q) => q.symbol),
          ...trending,
        ];
        tickers = Array.from(new Set([...tickers, ...extra]));
      }

      const batch = await yahooQuoteBatch(tickers);
      if (batch) {
        source = 'batch';
        for (const q of Object.values(batch)) {
          const e = fromBatch(q, marketInfo.session, nowSec);
          if (e) all.push(e);
        }
      } else {
        // --- 3. Ripiego: candele titolo per titolo --------------------
        source = 'candles';
        const MAX_TICKERS = 320;
        truncated = tickers.length > MAX_TICKERS;
        if (truncated) tickers = tickers.slice(0, MAX_TICKERS);
        all = Object.values(await yahooExtendedQuoteMany(tickers, 10));
      }
    }

    const counts = { pre: 0, post: 0, regular: 0, none: 0 };
    for (const q of all) counts[q.session]++;

    // In sessione estesa mostro i titoli che hanno effettivamente
    // scambiato in quella sessione. Gli altri riportano la variazione
    // regolare e falserebbero la classifica.
    let session: ExtendedQuote['session'];
    let relevant: ExtendedQuote[];
    if (marketInfo.session === 'pre') {
      session = 'pre';
      relevant = all.filter((q) => q.session === 'pre');
    } else if (marketInfo.session === 'post') {
      session = 'post';
      relevant = all.filter((q) => q.session === 'post');
    } else {
      session = 'regular';
      relevant = all;
    }

    const latestQuoteTime = relevant.reduce<number | null>(
      (max, q) =>
        q.quoteTime != null && (max == null || q.quoteTime > max)
          ? q.quoteTime
          : max,
      null
    );

    const filtered = relevant.filter(
      (q) => Number.isFinite(q.changePct) && Math.abs(q.changePct) >= minChange
    );

    const gainers = [...filtered]
      .filter((q) => q.changePct > 0)
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, limit);

    const losers = [...filtered]
      .filter((q) => q.changePct < 0)
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, limit);

    // Volume della sessione estesa: le quotazioni a lotti non lo danno,
    // le candele si'. Si scaricano solo per i titoli in classifica.
    if (extended && source === 'batch' && Date.now() - t0 < 30_000) {
      const shown = [...gainers, ...losers];
      const vols = await yahooExtendedQuoteMany(
        shown.map((q) => q.ticker),
        10
      );
      for (const q of shown) {
        const v = vols[q.ticker];
        if (v && v.session === q.session) q.extendedVolume = v.extendedVolume;
      }
    }

    return NextResponse.json({
      session,
      source,
      gainers,
      losers,
      // Secondi unix del dato piu' recente: la vista lo mostra cosi'
      // l'utente sa sempre a quando risale quello che sta guardando
      latestQuoteTime,
      serverTime: nowSec,
      sessionCounts: counts,
      marketInfo,
      stats: {
        requested: tickers.length,
        answered: all.length,
        inSession: relevant.length,
        aboveThreshold: filtered.length,
        truncated,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore movers: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
