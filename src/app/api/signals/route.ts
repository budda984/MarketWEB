import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/signals?status=ACTIVE&strength=2&limit=400
 * Restituisce i segnali dell'utente + i "pubblici" (user_id null).
 *
 * Se non ci sono filtri, carica in modo bilanciato: 150 HMA + 250 pattern.
 * Questo evita che tutti i 400 risultati siano dello stesso tipo quando
 * migliaia di righe condividono lo stesso signal_at.
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
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '400'), 600);

  // Se ci sono filtri espliciti, una query semplice con tie-breaker
  if (status || strength) {
    let q = supabase
      .from('signals')
      .select('*')
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    if (strength) q = q.eq('strength', parseInt(strength));
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ signals: data ?? [] });
  }

  // Caricamento bilanciato: HMA + pattern in parallelo
  const patternLimit = Math.floor(limit * 0.6);
  const hmaLimit = limit - patternLimit;

  const [hmaRes, patternRes] = await Promise.all([
    supabase
      .from('signals')
      .select('*')
      .eq('strategy', 'HMA50_HA')
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(hmaLimit),
    supabase
      .from('signals')
      .select('*')
      .like('strategy', 'PATTERN_%')
      .order('strength', { ascending: false })
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(patternLimit),
  ]);

  if (hmaRes.error) {
    return NextResponse.json({ error: hmaRes.error.message }, { status: 500 });
  }
  if (patternRes.error) {
    return NextResponse.json({ error: patternRes.error.message }, { status: 500 });
  }

  const merged = [...(hmaRes.data ?? []), ...(patternRes.data ?? [])].sort(
    (a, b) => {
      const d =
        new Date(b.signal_at).getTime() - new Date(a.signal_at).getTime();
      if (d !== 0) return d;
      return (b.strength ?? 0) - (a.strength ?? 0);
    }
  );

  return NextResponse.json({ signals: merged });
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
