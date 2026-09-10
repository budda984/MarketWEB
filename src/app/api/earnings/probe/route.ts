import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getYahooSession, yahooAuthedFetch } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/earnings/probe?ticker=IBM
 *
 * Prova gli endpoint Yahoo che espongono il calendario delle trimestrali
 * e riporta cosa rispondono da questo server.
 *
 * Serve a stabilire un fatto invece di assumerlo: Yahoo blocca alcuni
 * endpoint agli indirizzi dei datacenter, ma non tutti, e l'unico modo
 * di sapere quali e' provarli da dove gira l'applicazione.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') ?? 'IBM').toUpperCase();

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const targets: Array<{ name: string; url: string }> = [
    {
      name: 'quoteSummary calendarEvents',
      url: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=calendarEvents,earnings`,
    },
    {
      name: 'quoteSummary query2',
      url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=calendarEvents`,
    },
    {
      name: 'visualization earnings',
      url: 'https://query1.finance.yahoo.com/v1/finance/visualization?lang=en-US&region=US',
    },
    {
      name: 'v7 quote',
      url: `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`,
    },
    {
      name: 'chart (riferimento, sappiamo che funziona)',
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`,
    },
  ];

  const results = [];
  for (const t of targets) {
    try {
      const res = await fetch(t.url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.text();
      results.push({
        endpoint: t.name,
        status: res.status,
        ok: res.ok,
        bodyStart: body.slice(0, 160),
      });
    } catch (e) {
      results.push({
        endpoint: t.name,
        status: null,
        ok: false,
        bodyStart: e instanceof Error ? e.message : 'errore',
      });
    }
  }

  // ------------------------------------------------------------------
  // Prova con la sessione: cookie + crumb.
  // Il 401 "Invalid Crumb" indica che l'endpoint e' raggiungibile e
  // manca solo l'autenticazione, quindi vale la pena verificarlo.
  // ------------------------------------------------------------------
  const session = await getYahooSession(true);
  const authed: Array<Record<string, unknown>> = [];

  if (!session) {
    authed.push({
      endpoint: 'sessione',
      status: null,
      ok: false,
      bodyStart: 'Impossibile ottenere cookie e crumb da Yahoo.',
    });
  } else {
    authed.push({
      endpoint: 'sessione',
      status: 200,
      ok: true,
      bodyStart: `crumb ottenuto (${session.crumb.length} caratteri), cookie presente`,
    });

    // quoteSummary con crumb: date trimestrali e fondamentali
    const qs = await yahooAuthedFetch(
      (crumb) =>
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}` +
        `?modules=calendarEvents,earnings,defaultKeyStatistics,summaryDetail&crumb=${encodeURIComponent(crumb)}`
    );
    if (qs) {
      const body = await qs.text();
      authed.push({
        endpoint: 'quoteSummary con crumb',
        status: qs.status,
        ok: qs.ok,
        bodyStart: body.slice(0, 400),
      });
    }

    // Calendario delle trimestrali: e' un POST, non un GET
    const viz = await yahooAuthedFetch(
      (crumb) =>
        `https://query1.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size: 5,
          offset: 0,
          sortField: 'startdatetime',
          sortType: 'ASC',
          entityIdType: 'earnings',
          includeFields: [
            'ticker',
            'companyshortname',
            'startdatetime',
            'epsestimate',
            'epsactual',
          ],
          query: {
            operator: 'and',
            operands: [
              {
                operator: 'gte',
                operands: ['startdatetime', new Date().toISOString().slice(0, 10)],
              },
            ],
          },
        }),
      }
    );
    if (viz) {
      const body = await viz.text();
      authed.push({
        endpoint: 'calendario trimestrali (POST)',
        status: viz.status,
        ok: viz.ok,
        bodyStart: body.slice(0, 400),
      });
    }
  }

  return NextResponse.json({ ticker, senzaSessione: results, conSessione: authed });
}
