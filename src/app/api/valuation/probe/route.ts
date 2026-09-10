import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownload } from '@/lib/yahoo';
import { fetchYahooFinancials, fetchYahooProfile } from '@/lib/yahoo-fundamentals';
import { fetchFundamentalsYahoo } from '@/lib/valuation-yahoo';
import { buildVerdict } from '@/lib/valuation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/valuation/probe?ticker=ENI.MI
 *
 * Mostra cosa arriva da Yahoo per un titolo e il giudizio che ne esce,
 * forzando la fonte Yahoo anche per i titoli USA e senza salvare nulla.
 * Serve a controllare i numeri quando un giudizio sembra strano.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') ?? 'ENI.MI').toUpperCase();

  const [profile, financials, candles] = await Promise.all([
    fetchYahooProfile(ticker),
    fetchYahooFinancials(ticker),
    yahooDownload(ticker, '5y', '1d').catch(() => []),
  ]);
  const result = await fetchFundamentalsYahoo(ticker, candles);

  // Solo gli ultimi punti di ogni serie: basta per capire se i dati ci sono
  const tail = <T,>(arr: T[] | undefined, n = 6) => (arr ?? []).slice(-n);

  return NextResponse.json({
    ticker,
    profile,
    financials: financials && {
      currency: financials.currency,
      trailingEps: financials.trailingEps,
      quarterlyEps: tail(financials.quarterlyEps),
      annualEps: tail(financials.annualEps),
      quarterlyRevenue: tail(financials.quarterlyRevenue, 4),
      annualRevenue: tail(financials.annualRevenue, 4),
    },
    candles: candles.length,
    result: result.ok
      ? { fundamentals: result.f, debug: result.debug, verdict: buildVerdict(result.f) }
      : result,
  });
}
