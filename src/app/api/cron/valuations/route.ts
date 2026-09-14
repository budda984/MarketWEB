import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runValuationBatch } from '@/lib/valuation-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/valuations?budget=20000&max=15
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Un giro del motore delle valutazioni (vedi lib/valuation-engine.ts).
 *
 * Lo chiamano sia il cron giornaliero di Vercel sia il pianificatore
 * esterno, che sul piano gratuito e' l'unico modo di andare piu' spesso
 * di una volta al giorno. L'endpoint e' lo stesso: cambia solo chi lo
 * chiama e quanto spesso.
 *
 * DURATA DEL GIRO
 * Chi chiama decide quanto deve durare, perche' ogni chiamante ha un
 * tempo di attesa diverso: il cron di Vercel aspetta fino al minuto,
 * pg_net di Supabase di suo aspetta due secondi e va istruito. Un giro
 * che dura piu' dell'attesa di chi lo ha chiamato viene annullato a
 * meta', e il lavoro fatto va perso.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  // Il limite di Vercel resta 60 secondi: oltre, la funzione muore e
  // non si salva nulla
  const budgetMs = Math.min(
    Math.max(Number(url.searchParams.get('budget') ?? 48_000), 5_000),
    55_000
  );
  const maxTickers = Math.min(
    Math.max(Number(url.searchParams.get('max') ?? 40), 1),
    60
  );

  // Senza questo blocco un'eccezione qualsiasi diventa un 500 senza
  // corpo, e chi chiama (pg_net, il cron) registra solo il codice: il
  // motivo del guasto resta invisibile
  try {
    const result = await runValuationBatch(createAdminClient(), {
      budgetMs,
      maxTickers,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'errore sconosciuto',
        where: 'runValuationBatch',
      },
      { status: 500 }
    );
  }
}
