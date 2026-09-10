import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/earnings
 *
 * Due elenchi: le trimestrali gia' pubblicate, con date di deposito
 * reali, e quelle attese, la cui data e' STIMATA dalla cadenza storica.
 * Le date future non compaiono nei bilanci depositati: sono annunci
 * aziendali, e le fonti che li pubblicano richiedono una chiave.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();

  try {
    let q = supabase
      .from('earnings_reports')
      .select('*')
      .order('filed_date', { ascending: false, nullsFirst: false })
      .limit(120);
    if (ticker) q = q.eq('ticker', ticker);

    const { data: reports, error } = await q;
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

    // Attese: solo stime future, dalla piu' vicina
    const today = new Date().toISOString().slice(0, 10);
    const { data: upcoming } = await supabase
      .from('valuations')
      .select('ticker, next_report_estimate, cadence_days, last_report_date')
      .not('next_report_estimate', 'is', null)
      .gte('next_report_estimate', today)
      .order('next_report_estimate', { ascending: true })
      .limit(60);

    const { data: lastRow } = await supabase
      .from('earnings_reports')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      reports: reports ?? [],
      upcoming: upcoming ?? [],
      lastScan: lastRow?.updated_at ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
