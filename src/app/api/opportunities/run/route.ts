import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { SECTOR_ETFS, TICKER_SECTOR } from '@/lib/screener';
import {
  evaluateOpportunity,
  type Opportunity,
  type OpportunityInput,
} from '@/lib/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/opportunities/run
 * body: { offset?: number, requireWeeklyAbove?: boolean }
 *
 * Il trend settimanale e gli acquisti degli insider vengono LETTI dal
 * database, non ricalcolati: sono gia' stati prodotti dalle rispettive
 * sezioni. Si scaricano solo le candele giornaliere, e solo per i
 * titoli che hanno superato il filtro settimanale.
 *
 * Con ~400 titoli non si sta nei 60s di Vercel: la route elabora finche'
 * ha tempo e restituisce nextOffset per riprendere.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body.offset ?? 0));
  const requireWeeklyAbove = body.requireWeeklyAbove !== false;

  const t0 = Date.now();
  const admin = createAdminClient();
  const runDate = new Date().toISOString().slice(0, 10);

  try {
    // --- Stato settimanale dal database -------------------------------
    const { data: weeklyRows } = await supabase
      .from('weekly_trend_state')
      .select('ticker, state, flipped_at');

    const weeklyMap = new Map<
      string,
      { state: 'above' | 'below'; flippedAt: string | null }
    >();
    for (const w of weeklyRows ?? []) {
      weeklyMap.set(w.ticker, {
        state: w.state as 'above' | 'below',
        flippedAt: w.flipped_at,
      });
    }

    if (weeklyMap.size === 0) {
      return NextResponse.json(
        {
          error:
            "Lo stato del trend settimanale non e' ancora stato calcolato. Vai in Trend settimanale ed esegui una scansione: il radar si basa su quei dati.",
        },
        { status: 409 }
      );
    }

    // --- Universo: titoli USA che superano il filtro settimanale ------
    const usAll = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ])
    );
    const universe = requireWeeklyAbove
      ? usAll.filter((t) => weeklyMap.get(t)?.state === 'above')
      : usAll;

    // --- Acquisti insider recenti dal database ------------------------
    const since90 = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);
    const { data: insiderRows } = await supabase
      .from('insider_trades')
      .select('ticker, owner_name')
      .eq('transaction_code', 'P')
      .eq('is_derivative', false)
      .gte('transaction_date', since90)
      .limit(2000);

    const buyersByTicker = new Map<string, Set<string>>();
    for (const r of insiderRows ?? []) {
      if (!r.ticker) continue;
      const set = buyersByTicker.get(r.ticker) ?? new Set<string>();
      set.add(r.owner_name);
      buyersByTicker.set(r.ticker, set);
    }

    // --- Forza settoriale (12 richieste) ------------------------------
    let sectorPerf = new Map<string, number | null>();
    let sectorRank = new Map<string, number>();
    if (offset === 0) {
      try {
        const { rankSectors } = await import('@/lib/screener');
        const etfs = [...Object.keys(SECTOR_ETFS), 'SPY'];
        const sc = await yahooDownloadMany(etfs, '1y', '1d', 6);
        for (const s of rankSectors(sc)) {
          sectorPerf.set(s.etf, s.perf3m);
          sectorRank.set(s.etf, s.rank);
        }
      } catch {
        // La forza settoriale e' accessoria: se non arriva si prosegue
      }
    }

    // --- Elaborazione a scaglioni -------------------------------------
    const CHUNK = 40;
    const found: Opportunity[] = [];
    let evaluated = 0;
    let i = offset;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '1y', '1d', 8);

      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 200) continue;
        evaluated++;

        const etf = TICKER_SECTOR[ticker] ?? null;
        const w = weeklyMap.get(ticker);

        const input: OpportunityInput = {
          ticker,
          candles,
          weeklyState: w?.state ?? null,
          weeklyFlippedAt: w?.flippedAt ?? null,
          insiderBuyers: buyersByTicker.get(ticker)?.size ?? 0,
          market: getMarketForTicker(ticker),
          sectorName: etf ? SECTOR_ETFS[etf] : null,
          sectorRank: etf ? (sectorRank.get(etf) ?? null) : null,
          sectorPerf3m: etf ? (sectorPerf.get(etf) ?? null) : null,
        };

        const o = evaluateOpportunity(input, { requireWeeklyAbove });
        if (o) found.push(o);
      }

      i += CHUNK;
    }

    // --- Salvataggio ---------------------------------------------------
    // L'esito va verificato: senza questo controllo una scrittura fallita
    // restituirebbe comunque "N candidati trovati" e la lista resterebbe
    // vuota senza spiegazione.
    let saved = 0;
    if (found.length > 0) {
      const { error: saveErr } = await admin.from('opportunities').upsert(
        found.map((o) => ({
          run_date: runDate,
          ticker: o.ticker,
          market: o.market,
          sector_name: o.sectorName,
          sector_rank: o.sectorRank,
          price: o.price,
          weekly_state: o.weeklyState,
          weekly_flip_recent: o.weeklyFlipRecent,
          trend_score: o.trendScore,
          discount_score: o.discountScore,
          ha_score: o.haScore,
          insider_buyers: o.insiderBuyers,
          total_score: o.totalScore,
          rsi14: o.rsi14,
          dist_from_52w_high: o.distFrom52wHigh,
          dist_from_ma50: o.distFromMa50,
          perf_3m: o.perf3m,
          ha_flip_bars_ago: o.haFlipBarsAgo,
          trend_checks_passed: o.trendChecksPassed,
          reasons: o.reasons,
        })),
        { onConflict: 'run_date,ticker', ignoreDuplicates: false }
      );

      if (saveErr) {
        const missing = /schema cache|does not exist/i.test(saveErr.message);
        return NextResponse.json(
          {
            error: missing
              ? "Trovati candidati ma la tabella 'opportunities' non esiste: esegui la migration 009_opportunities.sql nell'SQL Editor di Supabase, poi rilancia."
              : `Salvataggio fallito: ${saveErr.message}`,
            stats: {
              universeSize: universe.length,
              processedUpTo: Math.min(i, universe.length),
              evaluated,
              matches: found.length,
              saved: 0,
            },
          },
          { status: 500 }
        );
      }
      saved = found.length;
    }

    const done = i >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : i,
      runDate,
      stats: {
        weeklyKnown: weeklyMap.size,
        universeSize: universe.length,
        processedUpTo: Math.min(i, universe.length),
        evaluated,
        matches: found.length,
        saved,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore radar: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
