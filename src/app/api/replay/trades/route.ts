import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET    /api/replay/trades            → { trades } in ordine di chiusura
 * POST   /api/replay/trades            → salva un trade chiuso
 * DELETE /api/replay/trades?id=...     → elimina un trade
 * DELETE /api/replay/trades?all=1      → azzera tutte le statistiche
 */

async function getUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('replay_trades')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: data ?? [] });
}

const NUM_FIELDS = [
  'entry_price',
  'planned_entry',
  'stop_price',
  'target_price',
  'exit_price',
  'r_multiple',
  'pnl_pct',
] as const;

export async function POST(req: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'Body non valido' }, { status: 400 });

  for (const f of NUM_FIELDS) {
    if (!Number.isFinite(Number(b[f]))) {
      return NextResponse.json({ error: `Campo ${f} non valido` }, { status: 400 });
    }
  }
  if (b.side !== 'LONG' && b.side !== 'SHORT') {
    return NextResponse.json({ error: 'side non valido' }, { status: 400 });
  }

  const row = {
    user_id: user.id,
    ticker: String(b.ticker ?? '').toUpperCase(),
    base_tf: String(b.base_tf ?? ''),
    timeframe: String(b.timeframe ?? ''),
    side: b.side,
    order_type: String(b.order_type ?? 'MARKET'),
    planned_entry: Number(b.planned_entry),
    entry_price: Number(b.entry_price),
    stop_price: Number(b.stop_price),
    target_price: Number(b.target_price),
    exit_price: Number(b.exit_price),
    exit_reason: String(b.exit_reason ?? 'MANUALE'),
    r_multiple: Number(b.r_multiple),
    pnl_pct: Number(b.pnl_pct),
    mae_r: b.mae_r == null ? null : Number(b.mae_r),
    mfe_r: b.mfe_r == null ? null : Number(b.mfe_r),
    bars_held: b.bars_held == null ? null : Math.round(Number(b.bars_held)),
    entry_time: Math.round(Number(b.entry_time)),
    exit_time: Math.round(Number(b.exit_time)),
  };

  const { data, error } = await supabase.from('replay_trades').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}

export async function DELETE(req: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const all = url.searchParams.get('all') === '1';

  let q = supabase.from('replay_trades').delete().eq('user_id', user.id);
  if (!all) {
    if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 });
    q = q.eq('id', id);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
