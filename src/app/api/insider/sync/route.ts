import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MARKETS } from '@/lib/tickers';
import {
  fetchTickerCikMap,
  fetchForm4Index,
  fetchAndParseForm4,
  recentDates,
  sleep,
  REQUEST_DELAY_MS,
  type InsiderTransaction,
} from '@/lib/sec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  /** Quanti giorni lavorativi indietro (default 3, max 10) */
  days?: number;
};

/**
 * POST /api/insider/sync
 *
 * Scarica gli indici giornalieri di EDGAR, tiene i Form 4 degli emittenti
 * presenti in S&P 500 e NASDAQ, li interpreta e li salva.
 *
 * Il collo di bottiglia sono i 60s di Vercel: con ~150 Form 4 al giorno di
 * cui una parte nostra, tre giorni per volta stanno comodi. Per recuperare
 * piu' storico basta rilanciare, i duplicati sono gestiti da UPSERT.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const days = Math.min(Math.max(body.days ?? 3, 1), 10);

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    // Universo: S&P 500 + NASDAQ
    const universe = new Set(
      [
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ].map((t) => t.toUpperCase())
    );

    // ------------------------------------------------------------------
    // Mappa CIK -> ticker.
    // La mappa ufficiale sta su un endpoint protetto che restituisce 403
    // quando l'IP e' sotto limitazione: la teniamo in cache su Supabase e
    // la riscarichiamo solo se manca o ha piu' di 30 giorni.
    // ------------------------------------------------------------------
    const CACHE_KEY = 'ticker_cik_map';
    const CACHE_MAX_AGE_MS = 30 * 86400 * 1000;

    let cikToTicker = new Map<string, string>();
    let mapSource = 'cache';

    const { data: cached } = await admin
      .from('sec_cache')
      .select('value, updated_at')
      .eq('key', CACHE_KEY)
      .maybeSingle();

    const cacheAge = cached?.updated_at
      ? Date.now() - new Date(cached.updated_at).getTime()
      : Infinity;
    const cacheUsable =
      cached?.value && Object.keys(cached.value).length > 0;

    if (cacheUsable && cacheAge < CACHE_MAX_AGE_MS) {
      for (const [cik, tk] of Object.entries(
        cached.value as Record<string, string>
      )) {
        cikToTicker.set(cik, tk);
      }
    } else {
      // Cache assente o scaduta: provo a riscaricarla
      try {
        const tickerMap = await fetchTickerCikMap();
        for (const t of universe) {
          const entry = tickerMap.get(t);
          if (entry) cikToTicker.set(entry.cik, entry.ticker);
        }
        mapSource = 'sec';
        if (cikToTicker.size > 0) {
          await admin.from('sec_cache').upsert(
            {
              key: CACHE_KEY,
              value: Object.fromEntries(cikToTicker),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' }
          );
        }
      } catch (e) {
        // Se il download fallisce ma ho una cache vecchia, la uso
        // comunque: i CIK non cambiano praticamente mai.
        if (cacheUsable) {
          for (const [cik, tk] of Object.entries(
            cached!.value as Record<string, string>
          )) {
            cikToTicker.set(cik, tk);
          }
          mapSource = 'cache-scaduta';
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          return NextResponse.json(
            {
              error: msg.includes('SEC_RATE_LIMITED')
                ? 'La SEC sta limitando le richieste da questo indirizzo (403). Aspetta qualche minuto e riprova: al primo tentativo riuscito la mappa viene salvata in cache e il problema non si ripresenta.'
                : `Impossibile costruire la mappa ticker/CIK: ${msg}`,
            },
            { status: 503 }
          );
        }
      }
    }

    if (cikToTicker.size === 0) {
      return NextResponse.json(
        { error: 'Mappa ticker/CIK vuota: nessun emittente da monitorare.' },
        { status: 503 }
      );
    }

    const dates = recentDates(days + 4).slice(0, days);
    let filingsSeen = 0;
    let filingsMatched = 0;
    let parsed = 0;
    let inserted = 0;
    const daysProcessed: string[] = [];
    const dbErrors: string[] = [];

    for (const date of dates) {
      // Margine di sicurezza sui 60s: mi fermo prima di essere ucciso
      if (Date.now() - t0 > 45000) break;

      const index = await fetchForm4Index(date);
      if (index.length === 0) continue;
      filingsSeen += index.length;
      daysProcessed.push(date.toISOString().slice(0, 10));

      // Un Form 4 compare nell'indice una volta per ciascun soggetto
      // (emittente e ogni dichiarante): deduplico sull'accession e
      // tengo solo quelli di un emittente che ci interessa.
      const wanted = new Map<string, (typeof index)[0]>();
      for (const e of index) {
        if (!cikToTicker.has(String(Number(e.cik)))) continue;
        if (!wanted.has(e.accession)) wanted.set(e.accession, e);
      }
      filingsMatched += wanted.size;

      const rows: InsiderTransaction[] = [];
      for (const entry of wanted.values()) {
        if (Date.now() - t0 > 50000) break;
        try {
          const txs = await fetchAndParseForm4(entry);
          if (txs.length > 0) {
            parsed++;
            rows.push(...txs);
          }
        } catch {
          // deposito illeggibile: lo salto, non blocco la sincronizzazione
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (rows.length > 0) {
        const payload = rows.map((r) => ({
          accession: r.accession,
          row_idx: r.rowIdx,
          filing_url: r.filingUrl,
          issuer_cik: r.issuerCik,
          ticker:
            r.ticker ?? cikToTicker.get(String(Number(r.issuerCik))) ?? null,
          issuer_name: r.issuerName,
          owner_name: r.ownerName,
          owner_title: r.ownerTitle,
          is_director: r.isDirector,
          is_officer: r.isOfficer,
          is_ten_percent: r.isTenPercent,
          transaction_date: r.transactionDate,
          filed_date: r.filedDate,
          transaction_code: r.transactionCode,
          acquired_disposed: r.acquiredDisposed,
          security_title: r.securityTitle,
          shares: r.shares,
          price: r.price,
          value: r.value,
          shares_owned_after: r.sharesOwnedAfter,
          is_derivative: r.isDerivative,
        }));

        // Dedup nel batch: la stessa chiave non puo' comparire due volte
        // nello stesso UPSERT (limite Postgres gia' incontrato sui segnali)
        const seen = new Map<string, (typeof payload)[0]>();
        for (const p of payload) {
          seen.set(`${p.accession}|${p.row_idx}`, p);
        }
        const deduped = Array.from(seen.values());

        const { error } = await admin
          .from('insider_trades')
          .upsert(deduped, {
            onConflict: 'accession,row_idx',
            ignoreDuplicates: false,
          });
        if (error) {
          if (!dbErrors.includes(error.message)) dbErrors.push(error.message);
        } else {
          inserted += deduped.length;
        }
      }
    }

    if (inserted === 0 && dbErrors.length > 0) {
      const missingTable = dbErrors.some(
        (m) => m.includes('insider_trades') && /schema cache|does not exist/i.test(m)
      );
      return NextResponse.json(
        {
          error: missingTable
            ? "La tabella insider_trades non esiste ancora. Esegui la migration 005_insider_trades.sql nell'SQL Editor di Supabase, poi riprova."
            : `Scrittura nel database fallita: ${dbErrors[0]}`,
          stats: {
            daysProcessed,
            filingsSeen,
            filingsMatched,
            filingsParsed: parsed,
            rowsUpserted: 0,
            elapsedMs: Date.now() - t0,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      dbErrors: dbErrors.length > 0 ? dbErrors : undefined,
      stats: {
        daysProcessed,
        mapSource,
        issuersTracked: cikToTicker.size,
        filingsSeen,
        filingsMatched,
        filingsParsed: parsed,
        rowsUpserted: inserted,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore sync insider: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
