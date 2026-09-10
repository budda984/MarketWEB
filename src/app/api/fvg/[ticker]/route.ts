import { NextResponse } from 'next/server';
import { yahooDownload } from '@/lib/yahoo';
import { detectOpenFvgs } from '@/lib/fvg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fvg/AAPL
 *
 * Fair value gap ancora aperti sul giornaliero.
 *
 * Il grafico giornaliero carica sei mesi, ma qui si cerca su due anni:
 * un FVG di otto mesi fa mai toccato e' proprio uno dei livelli che
 * contano, e sui soli sei mesi non si vedrebbe. Il grafico lo disegna a
 * partire dalla prima candela che ha.
 */
export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  try {
    const candles = await yahooDownload(ticker, '2y', '1d');
    const fvgs = detectOpenFvgs(candles);
    return NextResponse.json({ fvgs, lastTime: candles.at(-1)?.t ?? null });
  } catch (e) {
    return NextResponse.json(
      { fvgs: [], error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 200 }
    );
  }
}
