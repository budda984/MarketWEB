import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/drawings?ticker=AAPL  → { drawings: [...] }
 * PUT  /api/drawings              → body { ticker, drawings } upsert
 * DELETE /api/drawings?ticker=AAPL → elimina tutti i disegni del ticker
 */

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const { data, error } = await supabase
    .from('user_drawings')
    .select('drawings_json')
    .eq('user_id', user.id)
    .eq('ticker', ticker)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drawings: data?.drawings_json ?? [] });
}

export async function PUT(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ticker, drawings } = body as { ticker: string; drawings: unknown[] };
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  if (!Array.isArray(drawings))
    return NextResponse.json({ error: 'drawings must be array' }, { status: 400 });

  const { error } = await supabase.from('user_drawings').upsert(
    {
      user_id: user.id,
      ticker: ticker.toUpperCase(),
      drawings_json: drawings,
    },
    { onConflict: 'user_id,ticker' }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: drawings.length });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const { error } = await supabase
    .from('user_drawings')
    .delete()
    .eq('user_id', user.id)
    .eq('ticker', ticker);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
