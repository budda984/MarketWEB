import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchEarningsCalendar } from '@/lib/earnings-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/cron/earnings — tiene aggiornato il calendario. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 6 * 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const all = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      if (Date.now() - t0 > 40000) break;
      const page = await fetchEarningsCalendar(from, to, 100, offset);
      all.push(...page);
      if (page.length < 100) break;
    }

    let saved = 0;
    if (all.length > 0) {
      const seen = new Map<string, Record<string, unknown>>();
      for (const e of all) {
        seen.set(`${e.ticker}|${e.date}`, {
          ticker: e.ticker,
          event_date: e.date,
          company: e.company,
          timing: e.timing,
          eps_estimate: e.epsEstimate,
          eps_actual: e.epsActual,
          surprise_pct: e.surprisePct,
          updated_at: new Date().toISOString(),
        });
      }
      const { error } = await admin
        .from('earnings_calendar')
        .upsert(Array.from(seen.values()), {
          onConflict: 'ticker,event_date',
          ignoreDuplicates: false,
        });
      if (!error) saved = seen.size;
    }

    // Le date passate da oltre un mese non servono piu'
    const cutoff = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    await admin.from('earnings_calendar').delete().lt('event_date', cutoff);

    return NextResponse.json({
      ok: true,
      fetched: all.length,
      saved,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
