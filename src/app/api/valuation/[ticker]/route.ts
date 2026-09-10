import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownload } from '@/lib/yahoo';
import { fetchTickerCikMap } from '@/lib/sec';
import { getMarketForTicker } from '@/lib/tickers';
import { buildValuation, valuationDbErrorMessage } from '@/lib/valuation-row';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/valuation/AAPL
 *
 * Serve il giudizio dalla cache se recente, altrimenti lo ricostruisce
 * dai bilanci: SEC per i titoli USA, Yahoo per gli altri. I bilanci
 * cambiano quattro volte l'anno: aggiornare piu' spesso sarebbe inutile.
 */

// Strumenti senza bilancio: si risponde subito, senza interrogare nessuno
const NO_BALANCE_MARKETS = new Set(['Crypto', 'Forex', 'Commodities', 'ETF']);

function hasNoBalanceSheet(ticker: string): boolean {
  if (/[=^]/.test(ticker) || /-USD$|-EUR$/.test(ticker)) return true;
  const m = getMarketForTicker(ticker);
  return m != null && NO_BALANCE_MARKETS.has(m);
}

export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticker = decodeURIComponent(params.ticker).toUpperCase();

  if (hasNoBalanceSheet(ticker)) {
    return NextResponse.json({
      valuation: null,
      reason: 'La valutazione sui bilanci vale solo per le azioni.',
    });
  }

  const admin = createAdminClient();

  try {
    const { data: cached } = await supabase
      .from('valuations')
      .select('*')
      .eq('ticker', ticker)
      .maybeSingle();

    const MAX_AGE_DAYS = 20;
    if (cached?.updated_at) {
      const age =
        (Date.now() - new Date(cached.updated_at).getTime()) / 86400000;
      if (age < MAX_AGE_DAYS) {
        return NextResponse.json({ valuation: cached, cached: true });
      }
    }

    // Ricostruzione
    const [map, candles] = await Promise.all([
      fetchTickerCikMap(),
      yahooDownload(ticker, '5y', '1d'),
    ]);
    const built = await buildValuation(ticker, candles, map.get(ticker));
    if (!built.ok) {
      return NextResponse.json({ valuation: null, reason: built.reason });
    }

    const { error } = await admin
      .from('valuations')
      .upsert(built.row, { onConflict: 'ticker', ignoreDuplicates: false });
    if (error) {
      return NextResponse.json(
        { error: valuationDbErrorMessage(error.message) },
        { status: 500 }
      );
    }

    return NextResponse.json({ valuation: built.row, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
