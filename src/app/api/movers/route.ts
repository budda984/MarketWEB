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
