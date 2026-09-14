import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { fetchTickerCikMap } from '@/lib/sec';
import { sleep } from '@/lib/valuation';
import { valuationUniverse } from '@/lib/valuation-universe';
import { buildValuation, valuationDbErrorMessage } from '@/lib/valuation-row';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/valuations
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Il motore che tiene aggiornato l'archivio delle valutazioni senza che
 * nessuno debba tenere una pagina aperta.
 *
 * NIENTE PUNTATORE DI AVANZAMENTO
 * A ogni giro si ricalcola cosa manca: prima i titoli che nell'archivio
 * non ci sono, poi quelli piu' vecchi di MAX_AGE_DAYS, dal piu' stantio.
 * Un giro fallito o interrotto non lascia buchi, perche' quello dopo
 * ritrova gli stessi titoli ancora scoperti. Un puntatore, invece, va
 * avanti comunque e salta cio' che non e' riuscito.
 *
 * RITMO
 * I limiti della SEC impongono qualche secondo per titolo, quindi un
 * giro ne fa poche decine. Con un'esecuzione all'ora l'archivio si
 * riempie in un paio di giorni e poi si mantiene da solo: a regime la
 * maggior parte dei giri trova poco o nulla da fare e finisce subito.
 */

// Oltre questa eta' una valutazione va rifatta. I bilanci escono ogni
// tre mesi: un mese e' un compromesso fra freschezza e lavoro inutile.
const MAX_AGE_DAYS = 30;

// Si smette prima del limite di Vercel, per fare in tempo a salvare
const TIME_BUDGET_MS = 48_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = valuationUniverse();

    // Stato dell'archivio: poche centinaia di righe, due sole colonne
    const { data: existing, error: readError } = await admin
      .from('valuations')
      .select('ticker, updated_at');
    if (readError) {
      return NextResponse.json(
        { error: valuationDbErrorMessage(readError.message) },
        { status: 500 }
      );
    }

    const seen = new Map<string, number>();
    for (const r of existing ?? []) {
      seen.set(r.ticker, new Date(r.updated_at).getTime());
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    const missing = universe.filter((t) => !seen.has(t));
    const stale = universe
      .filter((t) => {
        const at = seen.get(t);
        return at != null && at < cutoff;
      })
      // Dal piu' vecchio: cosi' nessun titolo resta indietro per sempre
      .sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0));

    const queue = [...missing, ...stale];
    if (queue.length === 0) {
      return NextResponse.json({
        ok: true,
        done: true,
        covered: seen.size,
        universeSize: universe.length,
        message: 'Archivio completo e aggiornato.',
      });
    }

    // Piu' di cosi' non ne entrano comunque nel tempo disponibile
    const chunk = queue.slice(0, 40);
    const [map, candlesMap] = await Promise.all([
      fetchTickerCikMap(),
      yahooDownloadMany(chunk, '5y', '1d', 8),
    ]);

    const rows: Array<Record<string, unknown>> = [];
    const reportRows: Array<Record<string, unknown>> = [];
    let processed = 0;
    let skipped = 0;
    let fromSec = 0;
    let fromYahoo = 0;

    for (const ticker of chunk) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      processed++;
      const candles = candlesMap[ticker];
      if (!candles || candles.length < 100) {
        skipped++;
        continue;
      }
      const built = await buildValuation(ticker, candles, map.get(ticker));
      if (!built.ok) {
        skipped++;
        await sleep(150);
        continue;
      }
      if (built.source === 'sec') {
        fromSec++;
        for (const r of built.f.reports) {
          reportRows.push({
            ticker,
            period_end: r.periodEnd,
            filed_date: r.filedDate,
            eps: r.eps,
            revenue: r.revenue,
            form: r.form,
            updated_at: new Date().toISOString(),
          });
        }
      } else {
        fromYahoo++;
      }
      rows.push(built.row);
    }

    if (rows.length > 0) {
      const { error } = await admin
        .from('valuations')
        .upsert(rows, { onConflict: 'ticker', ignoreDuplicates: false });
      if (error) {
        return NextResponse.json(
          { error: valuationDbErrorMessage(error.message) },
          { status: 500 }
        );
      }
    }
    if (reportRows.length > 0) {
      // I trimestri sono un di piu': se falliscono non si perde la
      // valutazione, gia' salvata sopra
      await admin
        .from('quarterly_reports')
        .upsert(reportRows, { onConflict: 'ticker,period_end' });
    }

    const newlyCovered = rows.filter(
      (r) => !seen.has(r.ticker as string)
    ).length;

    return NextResponse.json({
      ok: true,
      done: false,
      saved: rows.length,
      skipped,
      processed,
      fromSec,
      fromYahoo,
      missingBefore: missing.length,
      staleBefore: stale.length,
      covered: seen.size + newlyCovered,
      universeSize: universe.length,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
