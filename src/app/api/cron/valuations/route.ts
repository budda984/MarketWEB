import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runValuationBatch } from '@/lib/valuation-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/valuations
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Un giro del motore delle valutazioni (vedi lib/valuation-engine.ts).
 *
 * Lo chiamano sia il cron giornaliero di Vercel sia il pianificatore
 * esterno, che sul piano gratuito e' l'unico modo di andare piu' spesso
 * di una volta al giorno. L'endpoint e' lo stesso: cambia solo chi lo
 * chiama e quanto spesso.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runValuationBatch(createAdminClient());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
