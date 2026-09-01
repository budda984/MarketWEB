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

  // Senza data esplicita uso l'ultima esecuzione disponibile
  if (!date) {
    const { data: last } = await supabase
      .from('opportunities')
      .select('run_date')
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle();
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
