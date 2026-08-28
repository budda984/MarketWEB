import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooExtendedQuoteMany, type ExtendedQuote } from '@/lib/yahoo';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { getMarketSession } from '@/lib/market-hours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/movers?universe=sp500|nasdaq|both&limit=20&minChange=1
 *
 * Yahoo non espone dai datacenter le classifiche pre-market gia' pronte
 * (l'endpoint screener risponde 403, come quoteSummary e search): le
 * costruiamo interrogando i singoli titoli e ordinando noi.
 *
 * Il costo e' una richiesta per titolo, quindi l'universo va tenuto
 * sotto controllo per rientrare nei 60s di Vercel.
 */
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

  const universeParam = url.searchParams.get('universe') ?? 'sp500';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);
  const minChange = Number(url.searchParams.get('minChange') ?? 1);

  const t0 = Date.now();

  try {
    let tickers: string[];
    if (universeParam === 'nasdaq') {
      tickers = [...((MARKETS['NASDAQ'] as readonly string[]) ?? [])];
    } else if (universeParam === 'both') {
      tickers = Array.from(
        new Set([
          ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
          ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
        ])
      );
    } else {
      tickers = [...((MARKETS['S&P 500'] as readonly string[]) ?? [])];
    }

    // Tetto prudenziale: oltre questa soglia si rischia il timeout.
    const MAX_TICKERS = 320;
    const truncated = tickers.length > MAX_TICKERS;
    if (truncated) tickers = tickers.slice(0, MAX_TICKERS);

    const quotes = await yahooExtendedQuoteMany(tickers, 10);
    const all = Object.values(quotes);

    // LA SESSIONE SI DEDUCE DALL'OROLOGIO, NON DAI DATI.
    //
    // Contare quanti titoli hanno gia' scambiato per decidere se il
    // pre-market e' aperto porta a dichiararlo chiuso proprio nei primi
    // minuti, quando hanno scambiato in pochi: e' cosi' che la vista
    // finiva per mostrare la chiusura del giorno prima.
    const marketInfo = getMarketSession();
    const counts = { pre: 0, post: 0, regular: 0, none: 0 };
    for (const q of all) counts[q.session]++;

    // In sessione estesa mostro i titoli che hanno effettivamente
    // scambiato in quella sessione. Gli altri riportano la variazione
    // regolare e falserebbero la classifica.
    let session: ExtendedQuote['session'];
    let inSessionQuotes: ExtendedQuote[];

    if (marketInfo.session === 'pre') {
      session = 'pre';
      inSessionQuotes = all.filter((q) => q.session === 'pre');
    } else if (marketInfo.session === 'post') {
      session = 'post';
      inSessionQuotes = all.filter((q) => q.session === 'post');
    } else {
      session = 'regular';
      inSessionQuotes = all;
    }

    const latestQuoteTime = inSessionQuotes.reduce<number | null>(
      (max, q) =>
        q.quoteTime != null && (max == null || q.quoteTime > max)
          ? q.quoteTime
          : max,
      null
    );

    // In sessione estesa considero solo i titoli che hanno effettivamente
    // scambiato: gli altri riporterebbero la variazione regolare,
    // falsando la classifica.
    const relevant = inSessionQuotes;

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

    return NextResponse.json({
      session,
      gainers,
      losers,
      // Secondi unix del dato piu' recente: la vista lo mostra cosi'
      // l'utente sa sempre a quando risale quello che sta guardando
      latestQuoteTime,
      serverTime: Math.floor(Date.now() / 1000),
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
