import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/opportunities?date=YYYY-MM-DD&minScore=0 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const minScore = Number(url.searchParams.get('minScore') ?? 0);
  let date = url.searchParams.get('date');

  // Senza data esplicita uso l'ultima esecuzione disponibile.
  // L'errore va controllato: se la tabella non esiste, ignorarlo
  // produrrebbe una lista vuota indistinguibile da "nessun risultato".
  if (!date) {
    const { data: last, error: lastErr } = await supabase
      .from('opportunities')
      .select('run_date')
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) {
      return NextResponse.json({ error: describeDbError(lastErr.message) }, { status: 500 });
    }
    date = last?.run_date ?? null;
  }

  if (!date) {
    return NextResponse.json({ results: [], runDate: null, availableDates: [] });
  }

  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('run_date', date)
    .gte('total_score', minScore)
    .order('total_score', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: dates } = await supabase
    .from('opportunities')
    .select('run_date')
    .order('run_date', { ascending: false })
    .limit(200);
  const availableDates = Array.from(
    new Set((dates ?? []).map((d) => d.run_date))
  ).slice(0, 30);

  return NextResponse.json({
    results: data ?? [],
    runDate: date,
    availableDates,
  });
}

/** Trasforma gli errori Postgres in messaggi che dicono cosa fare. */
function describeDbError(msg: string): string {
  if (/schema cache|does not exist|relation .* does not exist/i.test(msg)) {
    return "La tabella 'opportunities' non esiste ancora. Esegui la migration 009_opportunities.sql nell'SQL Editor di Supabase, poi rilancia la scansione.";
  }
  return `Errore database: ${msg}`;
}
