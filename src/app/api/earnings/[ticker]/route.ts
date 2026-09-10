import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownload } from '@/lib/yahoo';
import { fetchTickerCikMap } from '@/lib/sec';
import { fetchFundamentals } from '@/lib/valuation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/earnings/IBM
 *
 * Scarica i trimestri di un singolo titolo su richiesta, senza aspettare
 * la costruzione dell'intero archivio.
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
    const map = await fetchTickerCikMap();
    const entry = map.get(ticker);
    if (!entry) {
      return NextResponse.json({
        reports: [],
        reason: `${ticker} non risulta nell'anagrafica SEC: probabilmente non e' quotato negli Stati Uniti.`,
      });
    }

    const candles = await yahooDownload(ticker, '5y', '1d');
    const f = await fetchFundamentals(ticker, entry.cik, candles);
    if (!f || f.reports.length === 0) {
      return NextResponse.json({
        reports: [],
        reason: `Nessun trimestre ricavabile dai bilanci di ${ticker}. Puo' succedere quando l'azienda usa etichette XBRL diverse da quelle previste.`,
      });
    }

    const rows = f.reports.map((r) => ({
      ticker,
      period_end: r.periodEnd,
      filed_date: r.filedDate,
      eps: r.eps,
      revenue: r.revenue,
      form: r.form,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await admin
      .from('earnings_reports')
      .upsert(rows, { onConflict: 'ticker,period_end', ignoreDuplicates: false });

    if (error) {
      const missing = /schema cache|does not exist/i.test(error.message);
      return NextResponse.json(
        {
          error: missing
            ? "La tabella 'earnings_reports' non esiste ancora: esegui la migration 015_earnings.sql."
            : error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      reports: rows,
      nextReportEstimate: f.nextReportEstimate,
      cadenceDays: f.cadenceDays,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
