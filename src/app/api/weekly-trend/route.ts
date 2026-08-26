import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/weekly-trend?weeks=8&direction=all|bullish|bearish
 * Cambi di stato recenti + conteggio degli stati correnti.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const weeks = Math.min(Number(url.searchParams.get('weeks') ?? 8), 52);
  const direction = url.searchParams.get('direction') ?? 'all';

  const since = new Date(Date.now() - weeks * 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  let q = supabase
    .from('weekly_trend_flips')
    .select('*')
    .gte('bar_date', since)
    .order('bar_date', { ascending: false })
    .limit(400);
  if (direction !== 'all') q = q.eq('direction', direction);

  const { data: flips, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [aboveRes, belowRes, lastRes] = await Promise.all([
    supabase
      .from('weekly_trend_state')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'above'),
    supabase
      .from('weekly_trend_state')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'below'),
    supabase
      .from('weekly_trend_state')
      .select('bar_date, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    flips: flips ?? [],
    summary: {
      above: aboveRes.count ?? 0,
      below: belowRes.count ?? 0,
      lastBarDate: lastRes.data?.bar_date ?? null,
      lastUpdate: lastRes.data?.updated_at ?? null,
    },
  });
}
