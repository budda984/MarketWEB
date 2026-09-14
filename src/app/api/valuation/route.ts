import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { valuationDbErrorMessage } from '@/lib/valuation-row';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/valuation?limit=20&minDiscount=15&minGrowth=0
 *
 * Tre liste dallo stesso archivio:
 *
 *  - solid: la classifica stretta. Sconto sul multiplo storico E utili
 *    in crescita E fatturato in crescita, tutti insieme, ordinati per
 *    sconto. Le soglie arrivano dall'interfaccia.
 *  - opportunities: a sconto senza deterioramento dei conti. Piu' larga:
 *    non pretende che entrambe le voci crescano.
 *  - withCaution: a sconto ma con i conti in peggioramento.
 *
 * Le tre liste si sovrappongono: un titolo solido compare anche fra le
 * occasioni. Sono tagli diversi, non categorie separate.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);
  const minDiscount = Number(url.searchParams.get('minDiscount') ?? 15);
  const minGrowth = Number(url.searchParams.get('minGrowth') ?? 0);

  // Classifica stretta: filtrata e ordinata dal database, cosi' pesca
  // sull'intero archivio e non solo sulle prime righe
  const { data: solidData, error: solidError } = await supabase
    .from('valuations')
    .select('*')
    .neq('verdict_level', 'non_valutabile')
    .gte('pe_discount_pct', minDiscount)
    .gte('eps_growth_pct', minGrowth)
    .gte('revenue_growth_pct', minGrowth)
    .order('pe_discount_pct', { ascending: false })
    .limit(limit);

  if (solidError) {
    return NextResponse.json(
      { error: valuationDbErrorMessage(solidError.message) },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from('valuations')
    .select('*')
    .in('verdict_level', ['occasione', 'sconto_con_riserva'])
    .order('pe_discount_pct', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: valuationDbErrorMessage(error.message) },
      { status: 500 }
    );
  }

  const rows = data ?? [];
  const opportunities = rows
    .filter((r) => r.verdict_level === 'occasione')
    .slice(0, limit);
  const withCaution = rows
    .filter((r) => r.verdict_level === 'sconto_con_riserva')
    .slice(0, limit);

  // Quanti titoli superano il filtro stretto in tutto l'archivio: dice
  // se le soglie scelte sono troppo larghe o troppo strette
  const { count: solidTotal } = await supabase
    .from('valuations')
    .select('*', { count: 'exact', head: true })
    .neq('verdict_level', 'non_valutabile')
    .gte('pe_discount_pct', minDiscount)
    .gte('eps_growth_pct', minGrowth)
    .gte('revenue_growth_pct', minGrowth);

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
    solid: solidData ?? [],
    solidTotal: solidTotal ?? 0,
    opportunities,
    withCaution,
    analyzed: total ?? 0,
    lastScan: lastRow?.updated_at ?? null,
  });
}
