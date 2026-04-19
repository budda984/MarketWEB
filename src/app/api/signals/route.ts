import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/signals?status=ACTIVE&strength=2&limit=100
 * Restituisce i segnali dell'utente + i "pubblici" (user_id null).
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const strength = url.searchParams.get('strength');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200'), 500);

  let q = supabase
    .from('signals')
    .select('*')
    .order('signal_at', { ascending: false })
    .limit(limit);

  if (status) q = q.eq('status', status);
  if (strength) q = q.eq('strength', parseInt(strength));

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ signals: data ?? [] });
}

/**
 * PATCH /api/signals  body: { id, status, exit_price?, pnl_percent? }
 * Aggiorna lo stato di un segnale (es. TP/SL manuale).
 */
export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data, error } = await supabase
    .from('signals')
    .update({ ...updates, exit_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ signal: data });
}
