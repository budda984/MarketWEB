import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS } from '@/lib/tickers';
import { fetchTickerCikMap } from '@/lib/sec';
import { fetchFundamentals, buildVerdict, sleep } from '@/lib/valuation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/valuation/fill
 * body: { offset?: number }
 *
 * Popola l'archivio delle valutazioni. Ogni titolo richiede tre o
 * quattro chiamate alla SEC con la pausa imposta dai suoi limiti, quindi
 * il ritmo e' di pochi titoli al secondo: l'elaborazione procede a
 * scaglioni e va ripresa piu' volte.
 */
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

    for (const ticker of chunk) {
      if (Date.now() - t0 > 45000) break;
      const entry = map.get(ticker);
      const candles = candlesMap[ticker];
      if (!entry || !candles || candles.length < 100) {
        skipped++;
        continue;
      }
      const f = await fetchFundamentals(ticker, entry.cik, candles);
      if (!f) {
        skipped++;
        await sleep(150);
        continue;
      }
      for (const r of f.reports) {
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

      const v = buildVerdict(f);
      rows.push({
        ticker,
        price: f.price,
        ttm_eps: f.ttmEps,
        ttm_revenue: f.ttmRevenue,
        eps_growth_pct: f.epsGrowthPct,
        revenue_growth_pct: f.revenueGrowthPct,
        net_margin: f.netMargin,
        margin_change_pct: f.marginChangePct,
        current_pe: f.currentPe,
        median_pe: f.medianPe,
        pe_discount_pct: f.peDiscountPct,
        verdict_level: v.level,
        verdict_headline: v.headline,
        verdict_reasons: v.reasons,
        last_report_date: f.lastReportDate,
        next_report_estimate: f.nextReportEstimate,
        cadence_days: f.cadenceDays,
        quarters_available: f.quartersAvailable,
        updated_at: new Date().toISOString(),
      });
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
        const missing = /schema cache|does not exist/i.test(error.message);
        return NextResponse.json(
          {
            error: missing
              ? "La tabella 'valuations' non esiste ancora: esegui la migration 012_valuation.sql."
              : `Salvataggio fallito: ${error.message}`,
          },
          { status: 500 }
        );
      }
      saved = rows.length;
    }

    const next = offset + BATCH;
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
