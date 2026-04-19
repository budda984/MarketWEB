import { NextResponse } from 'next/server';
import { yahooQuote, yahooDownload } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quote/[ticker]
 * Returns quote + ultime 90 candele per il chart.
 */
export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();

  const [q, candles] = await Promise.all([
    yahooQuote(ticker),
    yahooDownload(ticker, '6mo', '1d'),
  ]);

  if (!q && candles.length === 0) {
    return NextResponse.json(
      { error: `No data for ${ticker}` },
      { status: 404 }
    );
  }

  return NextResponse.json({ quote: q, candles });
}
