import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: regole dell'utente + ultimi scatti */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [rulesRes, hitsRes] = await Promise.all([
    supabase
      .from('auto_alert_rules')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('auto_alert_hits')
      .select('*')
      .eq('user_id', user.id)
      .eq('state', 'armed')
      .order('triggered_at', { ascending: false })
      .limit(200),
  ]);

  if (rulesRes.error)
    return NextResponse.json({ error: rulesRes.error.message }, { status: 500 });

  return NextResponse.json({
    rules: rulesRes.data ?? [],
    hits: hitsRes.data ?? [],
  });
}

/** POST: crea una regola */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body.market)
    return NextResponse.json({ error: 'market obbligatorio' }, { status: 400 });

  const thresholdPct = Number(body.threshold_pct ?? 10);
  const rearmPct = Number(body.rearm_pct ?? 18);
  if (rearmPct <= thresholdPct) {
    return NextResponse.json(
      {
        error:
          'La soglia di riarmo deve essere maggiore di quella di ingresso, altrimenti la stessa notifica si ripeterebbe ogni giorno.',
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('auto_alert_rules')
    .insert({
      user_id: user.id,
      name: body.name ?? null,
      market: body.market,
      lookback_days: Number(body.lookback_days ?? 126),
      threshold_pct: thresholdPct,
      rearm_pct: rearmPct,
      max_drop_30d_pct: Number(body.max_drop_30d_pct ?? 25),
      notify_telegram: body.notify_telegram !== false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

/** PATCH: attiva/disattiva o modifica */
export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'id obbligatorio' }, { status: 400 });

  const { data, error } = await supabase
    .from('auto_alert_rules')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

/** DELETE: elimina una regola (e i suoi scatti, per cascade) */
export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obbligatorio' }, { status: 400 });

  const { error } = await supabase
    .from('auto_alert_rules')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
