import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS } from '@/lib/tickers';
import { fetchTickerCikMap } from '@/lib/sec';
import { sleep } from '@/lib/valuation';
import { buildValuation, valuationDbErrorMessage } from '@/lib/valuation-row';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/valuation/fill
 * body: { offset?: number }
 *
 * Popola l'archivio delle valutazioni. Prima i titoli USA, dai bilanci
 * SEC; poi le azioni degli altri mercati, dai bilanci Yahoo. Per la SEC
 * ogni titolo richiede tre o quattro chiamate con la pausa imposta dai
 * suoi limiti, quindi l'elaborazione procede a scaglioni e va ripresa
 * piu' volte.
 */

// Mercati azionari fuori dagli USA: niente crypto, cambi, materie prime
// ed ETF, che un bilancio non ce l'hanno
const NON_US_EQUITY = [
  'Italia', 'Francia', 'Germania', 'Olanda', 'UK', 'Spagna', 'Svizzera',
  'Svezia', 'Danimarca', 'Norvegia', 'Finlandia', 'Austria', 'Belgio',
  'Portogallo', 'Polonia', 'Turchia', 'Grecia', 'Giappone',
] as const;
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body.offset ?? 0));

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
        ...NON_US_EQUITY.flatMap(
          (m) => (MARKETS[m] as readonly string[] | undefined) ?? []
        ),
      ])
    );

    const map = await fetchTickerCikMap();

    // Lotti piccoli: il collo di bottiglia e' il ritmo consentito dalla SEC
    const BATCH = 12;
    const chunk = universe.slice(offset, offset + BATCH);
    if (chunk.length === 0) {
      return NextResponse.json({
        ok: true,
        done: true,
        nextOffset: null,
        stats: { universeSize: universe.length, processed: 0, saved: 0 },
      });
    }

    const candlesMap = await yahooDownloadMany(chunk, '5y', '1d', 6);
    const rows: Array<Record<string, unknown>> = [];
    const reportRows: Array<Record<string, unknown>> = [];
    let skipped = 0;

    let processed = 0;
    let fromSec = 0;
    let fromYahoo = 0;
    for (const ticker of chunk) {
      // Si esce prima dei 60 secondi: i titoli rimasti si riprendono al
      // giro successivo, perche' nextOffset conta solo quelli fatti
      if (Date.now() - t0 > 45000) break;
      processed++;
      const entry = map.get(ticker);
      const candles = candlesMap[ticker];
      if (!candles || candles.length < 100) {
        skipped++;
        continue;
      }
      const built = await buildValuation(ticker, candles, entry);
      if (!built.ok) {
        skipped++;
        await sleep(150);
        continue;
      }
      if (built.source === 'sec') {
        fromSec++;
        // I trimestri con data di deposito esistono solo nei bilanci SEC
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

    // I trimestri arrivano dagli stessi bilanci gia' scaricati: salvarli
    // qui evita di interrogare di nuovo la SEC
    if (reportRows.length > 0) {
      const seen = new Map<string, (typeof reportRows)[0]>();
      for (const r of reportRows) seen.set(`${r.ticker}|${r.period_end}`, r);
      await admin
        .from('earnings_reports')
        .upsert(Array.from(seen.values()), {
          onConflict: 'ticker,period_end',
          ignoreDuplicates: false,
        });
    }

    let saved = 0;
    if (rows.length > 0) {
      const { error } = await admin
        .from('valuations')
        .upsert(rows, { onConflict: 'ticker', ignoreDuplicates: false });
      if (error) {
        return NextResponse.json(
          { error: `Salvataggio fallito: ${valuationDbErrorMessage(error.message)}` },
          { status: 500 }
        );
      }
      saved = rows.length;
    }

    // Almeno un passo avanti, per non ripetere all'infinito lo stesso lotto
    const next = offset + Math.max(processed, 1);
    const done = next >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : next,
      stats: {
        universeSize: universe.length,
        processedUpTo: Math.min(next, universe.length),
        saved,
        skipped,
        fromSec,
        fromYahoo,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
