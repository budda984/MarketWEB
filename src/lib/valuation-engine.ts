/**
 * Un giro del motore delle valutazioni.
 *
 * Lo stesso lavoro serve a tre chiamanti: il cron giornaliero di Vercel,
 * il pianificatore esterno e il recupero avviato dall'app quando la
 * pagina e' aperta. Sta qui in mezzo perche' una logica sola significa
 * una coda sola: se i tre lavorassero in modo diverso, la copertura non
 * tornerebbe mai.
 *
 * NIENTE PUNTATORE DI AVANZAMENTO
 * A ogni giro si ricalcola cosa manca: prima i titoli che nell'archivio
 * non ci sono, poi quelli piu' vecchi di MAX_AGE_DAYS, dal piu' stantio.
 * Un giro fallito o interrotto non lascia buchi, perche' quello dopo
 * ritrova gli stessi titoli ancora scoperti. Un puntatore, invece, va
 * avanti comunque e salta cio' che non e' riuscito.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { yahooDownloadMany } from './yahoo';
import { fetchTickerCikMap } from './sec';
import { sleep } from './valuation';
import { valuationUniverse } from './valuation-universe';
import { buildValuation, valuationDbErrorMessage } from './valuation-row';

// Oltre questa eta' una valutazione va rifatta. I bilanci escono ogni
// tre mesi: un mese e' un compromesso fra freschezza e lavoro inutile.
const MAX_AGE_DAYS = 30;

export type BatchOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      done: boolean;
      saved: number;
      skipped: number;
      processed: number;
      fromSec: number;
      fromYahoo: number;
      covered: number;
      universeSize: number;
      remaining: number;
      elapsedMs: number;
      /** Titoli che hanno sollevato un errore, con il motivo */
      failures: Array<{ ticker: string; error: string }>;
    };

export async function runValuationBatch(
  admin: SupabaseClient,
  opts: { budgetMs?: number; maxTickers?: number } = {}
): Promise<BatchOutcome> {
  const t0 = Date.now();
  // Si smette prima del limite di Vercel, per fare in tempo a salvare
  const budgetMs = opts.budgetMs ?? 48_000;
  const maxTickers = opts.maxTickers ?? 40;

  const universe = valuationUniverse();

  // Stato dell'archivio: poche centinaia di righe, due sole colonne
  const { data: existing, error: readError } = await admin
    .from('valuations')
    .select('ticker, updated_at');
  if (readError) {
    return { ok: false, error: valuationDbErrorMessage(readError.message) };
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
    return {
      ok: true,
      done: true,
      saved: 0,
      skipped: 0,
      processed: 0,
      fromSec: 0,
      fromYahoo: 0,
      covered: seen.size,
      universeSize: universe.length,
      remaining: 0,
      elapsedMs: Date.now() - t0,
      failures: [],
    };
  }

  const chunk = queue.slice(0, maxTickers);

  // Le due fonti comuni al lotto: se cadono qui, cade tutto il giro, ed
  // e' utile sapere quale delle due
  let map: Awaited<ReturnType<typeof fetchTickerCikMap>>;
  let candlesMap: Awaited<ReturnType<typeof yahooDownloadMany>>;
  try {
    map = await fetchTickerCikMap();
  } catch (e) {
    return {
      ok: false,
      error: `anagrafica SEC: ${e instanceof Error ? e.message : 'errore'}`,
    };
  }
  try {
    candlesMap = await yahooDownloadMany(chunk, '5y', '1d', 8);
  } catch (e) {
    return {
      ok: false,
      error: `storico prezzi: ${e instanceof Error ? e.message : 'errore'}`,
    };
  }

  const rows: Array<Record<string, unknown>> = [];
  const reportRows: Array<Record<string, unknown>> = [];
  let processed = 0;
  let skipped = 0;
  let fromSec = 0;
  let fromYahoo = 0;

  const failures: Array<{ ticker: string; error: string }> = [];

  for (const ticker of chunk) {
    if (Date.now() - t0 > budgetMs) break;
    processed++;
    const candles = candlesMap[ticker];
    if (!candles || candles.length < 100) {
      skipped++;
      continue;
    }

    // Un singolo titolo con dati inattesi non deve far cadere il giro:
    // si annota, si va avanti, e il motivo finisce nella risposta
    let built: Awaited<ReturnType<typeof buildValuation>>;
    try {
      built = await buildValuation(ticker, candles, map.get(ticker));
    } catch (e) {
      failures.push({
        ticker,
        error: e instanceof Error ? e.message : 'errore sconosciuto',
      });
      skipped++;
      continue;
    }

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
      return { ok: false, error: valuationDbErrorMessage(error.message) };
    }
  }
  if (reportRows.length > 0) {
    // Un upsert non puo' toccare due volte la stessa riga nello stesso
    // comando: se un titolo riporta due volte lo stesso trimestre, senza
    // questa deduplicazione l'intero salvataggio fallisce
    const unici = new Map<string, (typeof reportRows)[number]>();
    for (const r of reportRows) unici.set(`${r.ticker}|${r.period_end}`, r);

    // I trimestri sono un di piu': se falliscono non si perde la
    // valutazione, gia' salvata sopra
    await admin
      .from('earnings_reports')
      .upsert(Array.from(unici.values()), {
        onConflict: 'ticker,period_end',
        ignoreDuplicates: false,
      });
  }

  const newlyCovered = rows.filter((r) => !seen.has(r.ticker as string)).length;

  return {
    ok: true,
    // Finito quando la coda si esaurisce: i titoli scartati (senza dati
    // sufficienti) restano nella coda e si riprovano al giro dopo, ma
    // non bloccano nulla perche' ogni giro riparte dai mancanti
    done: queue.length <= processed,
    saved: rows.length,
    skipped,
    processed,
    fromSec,
    fromYahoo,
    covered: seen.size + newlyCovered,
    universeSize: universe.length,
    remaining: Math.max(0, queue.length - processed),
    elapsedMs: Date.now() - t0,
    failures,
  };
}
