import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownload } from '@/lib/yahoo';
import { fetchTickerCikMap } from '@/lib/sec';
import { fetchFundamentals, buildVerdict } from '@/lib/valuation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/valuation/AAPL
 *
 * Serve il giudizio dalla cache se recente, altrimenti lo ricostruisce
 * dai bilanci. I bilanci cambiano quattro volte l'anno: aggiornare piu'
 * spesso sarebbe inutile e peserebbe sui limiti della SEC.
 */
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
    const map = await fetchTickerCikMap();
    const entry = map.get(ticker);
    if (!entry) {
      return NextResponse.json({
        valuation: null,
        reason: 'Titolo non presente nell\'anagrafica SEC: probabilmente non e\' quotato negli Stati Uniti.',
      });
    }

    const candles = await yahooDownload(ticker, '5y', '1d');
    const f = await fetchFundamentals(ticker, entry.cik, candles);
    if (!f) {
      return NextResponse.json({
        valuation: null,
        reason: 'Dati di bilancio insufficienti per questo titolo.',
      });
    }

    const v = buildVerdict(f);
    const row = {
      ticker,
      price: f.price,
      ttm_eps: f.ttmEps,
      ttm_revenue: f.ttmRevenue,
      eps_growth_pct: f.epsGrowthPct,
      revenue_growth_pct: f.revenueGrowthPct,
      net_margin: f.netMargin,
      margin_change_pct: f.marginChangePct,
      current_pe: f.currentPe,
      median_pe: f.medianPe,
      pe_discount_pct: f.peDiscountPct,
      verdict_level: v.level,
      verdict_headline: v.headline,
      verdict_reasons: v.reasons,
      last_report_date: f.lastReportDate,
      quarters_available: f.quartersAvailable,
      updated_at: new Date().toISOString(),
    };

    const { error } = await admin
      .from('valuations')
      .upsert(row, { onConflict: 'ticker', ignoreDuplicates: false });
    if (error) {
      const missing = /schema cache|does not exist/i.test(error.message);
      return NextResponse.json(
        {
          error: missing
            ? "La tabella 'valuations' non esiste ancora: esegui la migration 012_valuation.sql."
            : error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ valuation: row, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
