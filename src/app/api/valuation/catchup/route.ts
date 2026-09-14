import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runValuationBatch } from '@/lib/valuation-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/valuation/catchup
 *
 * Un giro del motore avviato dall'app invece che dal cron, per chi non
 * vuole aspettare. Stessa coda del cron, quindi i due non si pestano i
 * piedi: chi arriva secondo trova meno titoli scoperti e ne fa altri.
 *
 * Sostituisce il vecchio riempimento a offset, che ripartiva sempre da
 * capo e rifaceva titoli gia' aggiornati.
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await runValuationBatch(createAdminClient());
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
