import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/valuation?limit=10
 * Le occasioni migliori: titoli a sconto con i conti che reggono.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 50);

  const { data, error } = await supabase
    .from('valuations')
    .select('*')
    .in('verdict_level', ['occasione', 'caro_ma_in_crescita', 'sconto_con_riserva'])
    .order('pe_discount_pct', { ascending: false })
    .limit(200);

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

  const rows = data ?? [];
  // In cima solo le vere occasioni: a sconto E senza deterioramento dei
  // conti. Le altre categorie restano consultabili sotto.
  const opportunities = rows
    .filter((r) => r.verdict_level === 'occasione')
    .slice(0, limit);
  const withCaution = rows
    .filter((r) => r.verdict_level === 'sconto_con_riserva')
    .slice(0, limit);

  const { count: total } = await supabase
    .from('valuations')
    .select('*', { count: 'exact', head: true });

  const { data: lastRow } = await supabase
    .from('valuations')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    opportunities,
    withCaution,
    analyzed: total ?? 0,
    lastScan: lastRow?.updated_at ?? null,
  });
}
