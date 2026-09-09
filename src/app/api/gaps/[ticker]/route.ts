import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownload } from '@/lib/yahoo';
import { analyzeGaps } from '@/lib/gaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/gaps/AAPL — gap del singolo titolo, per il disegno sul grafico.
 *
 * Calcolo al momento invece di leggere l'archivio: e' una sola richiesta
 * e restituisce anche i gap non ancora presenti in archivio.
 */
export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  try {
    const candles = await yahooDownload(ticker, '1y', '1d');
    if (candles.length < 30) return NextResponse.json({ gaps: [] });

    const r = analyzeGaps(ticker, candles, 2);
    if (!r) return NextResponse.json({ gaps: [] });

    // Indice per data, per convertire le date in timestamp del grafico
    const timeByDate = new Map<string, number>();
    for (const c of candles) {
      timeByDate.set(new Date(c.t * 1000).toISOString().slice(0, 10), c.t);
    }
    const lastTime = candles[candles.length - 1].t;

    // Solo i gap dell'ultimo anno, al massimo otto: oltre il grafico
    // diventa illeggibile
    const gaps = r.allGaps
      .slice(-8)
      .map((g) => ({
        time: timeByDate.get(g.date) ?? null,
        endTime: g.fillDate ? (timeByDate.get(g.fillDate) ?? lastTime) : lastTime,
        direction: g.direction,
        gapPct: g.gapPct,
        openPrice: g.openPrice,
        targetPrice: g.targetPrice,
        edgePrice: g.edgePrice,
        filled: g.filled,
        daysOpen: g.daysOpen,
      }))
      .filter((g) => g.time != null);

    return NextResponse.json({ gaps });
  } catch {
    return NextResponse.json({ gaps: [] });
  }
}
