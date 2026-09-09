import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { detectFormations } from '@/lib/formations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/formations
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Tiene aggiornato l'archivio delle figure senza intervento manuale.
 * Le figure che non vengono piu' rilevate restano in archivio con la
 * loro ultima data: si distinguono dalla data di ultimo avvistamento.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ])
    );

    let found = 0;
    let truncated = false;
    const now = new Date().toISOString();
    const CHUNK = 40;

    for (let i = 0; i < universe.length; i += CHUNK) {
      if (Date.now() - t0 > 42000) {
        truncated = true;
        break;
      }
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '1y', '1d', 8);

      const rows: Array<Record<string, unknown>> = [];
      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 80) continue;
        for (const f of detectFormations(ticker, candles)) {
          rows.push({
            ticker: f.ticker,
            kind: f.kind,
            state: f.state,
            neckline: f.neckline,
            price: f.price,
            distance_to_neckline_pct: f.distanceToNecklinePct,
            depth_pct: f.depthPct,
            target: f.target,
            bars_span: f.barsSpan,
            points: f.points,
            market: getMarketForTicker(ticker),
            last_seen: now,
            first_state: f.state,
          });
        }
      }

      if (rows.length > 0) {
        const seen = new Map<string, (typeof rows)[0]>();
        for (const r of rows) seen.set(`${r.ticker}|${r.kind}`, r);
        const deduped = Array.from(seen.values());
        const { error } = await admin
          .from('formations')
          .upsert(deduped, {
            onConflict: 'ticker,kind',
            ignoreDuplicates: false,
          });
        if (!error) found += deduped.length;
      }
    }

    // Pulizia: le figure non piu' rilevate da oltre tre settimane sono
    // decadute e affollerebbero l'archivio
    const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
    await admin.from('formations').delete().lt('last_seen', cutoff);

    return NextResponse.json({
      ok: true,
      universeSize: universe.length,
      found,
      truncated,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
