import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooQuoteBatch, yahooPredefinedScreen } from '@/lib/yahoo-market';
import { MARKETS } from '@/lib/tickers';
import {
  sessionProgress,
  toVolumeRow,
  isLiquidEnough,
  DEFAULT_MIN_AVG_VOLUME,
  DEFAULT_MIN_TURNOVER,
  type VolumeRow,
} from '@/lib/volume';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/volume?universe=sp500|nasdaq|both|all&limit=25&minAvg=200000
 *
 * Due classifiche dalla stessa interrogazione:
 *
 *  - byVolume: chi scambia di piu' in assoluto. Dice dove si concentra
 *    l'attenzione del mercato, ma in cima ci sono quasi sempre gli
 *    stessi giganti: e' una classifica stabile per costruzione.
 *  - byRatio: chi scambia molto piu' del proprio normale. E' quella che
 *    segnala qualcosa di nuovo, perche' un titolo che fa cinque volte i
 *    suoi volumi abituali ha una ragione per farlo.
 *
 * Il rapporto e' corretto per la parte di giornata trascorsa, altrimenti
 * a meta' seduta risulterebbe sempre sotto 1 (vedi lib/volume.ts).
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const universeParam = url.searchParams.get('universe') ?? 'both';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 50);
  const minAvgVolume = Math.max(
    0,
    Number(url.searchParams.get('minAvg') ?? DEFAULT_MIN_AVG_VOLUME)
  );

  const t0 = Date.now();
  const progress = sessionProgress();

  try {
    const sp = (MARKETS['S&P 500'] as readonly string[]) ?? [];
    const nq = (MARKETS['NASDAQ'] as readonly string[]) ?? [];
    let tickers: string[] =
      universeParam === 'sp500'
        ? [...sp]
        : universeParam === 'nasdaq'
          ? [...nq]
          : Array.from(new Set([...sp, ...nq]));

    // Su tutto il mercato si aggiungono i titoli che Yahoo stesso segnala
    // come piu' scambiati: sono esattamente quelli che una classifica di
    // volumi deve contenere, e stanno fuori dall'universo abituale
    let widened = false;
    if (universeParam === 'all') {
      const actives = await yahooPredefinedScreen('most_actives', 100);
      if (actives && actives.length > 0) {
        widened = true;
        tickers = Array.from(
          new Set([...tickers, ...actives.map((q) => q.symbol)])
        );
      }
    }

    const batch = await yahooQuoteBatch(tickers);
    if (!batch) {
      return NextResponse.json(
        {
          error:
            'Yahoo non ha risposto alle quotazioni a lotti. Riprova fra qualche minuto.',
        },
        { status: 502 }
      );
    }

    const opts = {
      progress: progress.fraction,
      minAvgVolume,
      minTurnover: DEFAULT_MIN_TURNOVER,
    };

    const rows: VolumeRow[] = [];
    for (const q of Object.values(batch)) {
      const r = toVolumeRow(q, opts);
      if (r) rows.push(r);
    }

    const byVolume = [...rows]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);

    // Sul rapporto si applica il filtro di liquidita': senza, la
    // classifica sarebbe dominata da titoli che scambiano pochissimo
    const liquid = rows.filter((r) => isLiquidEnough(r, opts));
    const byRatio = liquid
      .filter((r) => r.volumeRatio != null)
      .sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))
      .slice(0, limit);

    return NextResponse.json({
      byVolume,
      byRatio,
      session: {
        ...progress,
        // Percentuale di giornata gia' scambiata secondo la curva
        progressPct: Math.round(progress.fraction * 100),
      },
      stats: {
        requested: tickers.length,
        answered: rows.length,
        liquid: liquid.length,
        widened,
        minAvgVolume,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore volumi: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
