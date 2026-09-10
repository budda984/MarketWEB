import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchEarningsCalendar } from '@/lib/earnings-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/earnings/sync
 *
 * Scarica il calendario per le prossime settimane. Una richiesta copre
 * molte societa', quindi bastano poche pagine.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const weeks = Math.min(Math.max(Number(body.weeks ?? 6), 1), 12);

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + weeks * 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const all = [];
    // Paginazione: l'endpoint limita il numero di righe per richiesta
    for (let offset = 0; offset < 1000; offset += 100) {
      if (Date.now() - t0 > 40000) break;
      const page = await fetchEarningsCalendar(from, to, 100, offset);
      all.push(...page);
      if (page.length < 100) break;
    }

    if (all.length === 0) {
      return NextResponse.json(
        {
          error:
            'Yahoo non ha restituito date. Puo\' essere una sessione non ottenuta: riprova fra qualche minuto.',
        },
        { status: 502 }
      );
    }

    // Una societa' puo' comparire piu' volte se la data viene rivista
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

    if (error) {
      const missing = /schema cache|does not exist/i.test(error.message);
      return NextResponse.json(
        {
          error: missing
            ? "La tabella 'earnings_calendar' non esiste ancora: esegui la migration 016_earnings_calendar.sql."
            : error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      fetched: all.length,
      saved: seen.size,
      from,
      to,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
