import { NextResponse } from 'next/server';
import {
  yahooQuoteFull,
  yahooDownload,
  type OHLCV,
  type Period,
  type Interval,
} from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quote/[ticker]?tf=1h|4h|1d|1w
 * Returns quote arricchito + candele per il chart.
 */
export async function GET(
  req: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  const url = new URL(req.url);
  const tf = url.searchParams.get('tf') ?? '1d';

  const { period, interval, needsAggregation } = resolveTimeframe(tf);

  const [q, rawCandles] = await Promise.all([
    yahooQuoteFull(ticker),
    yahooDownload(ticker, period, interval),
  ]);

  const candles = needsAggregation ? aggregate4h(rawCandles) : rawCandles;

  if (!q && candles.length === 0) {
    return NextResponse.json(
      { error: `No data for ${ticker} (tf=${tf})` },
      { status: 404 }
    );
  }

  return NextResponse.json({ quote: q, candles, timeframe: tf });
}

function resolveTimeframe(tf: string): {
  period: Period;
  interval: Interval;
  needsAggregation: boolean;
} {
  switch (tf) {
    case '1h':
      return { period: '2y', interval: '1h', needsAggregation: false };
    case '4h':
      // Yahoo non ha 4h: scarichiamo 1h e aggreghiamo 4-a-4
      return { period: '2y', interval: '1h', needsAggregation: true };
    case '1w':
    case '1wk':
      return { period: '5y', interval: '1wk', needsAggregation: false };
    case '1d':
    default:
      return { period: '6mo', interval: '1d', needsAggregation: false };
  }
}

/**
 * Aggrega 4 candele orarie in una candela 4h.
 * Le candele Yahoo 1h sono allineate alle ore di sessione di mercato.
 * Aggregiamo in blocchi consecutivi di 4, partendo dalla prima candela.
 */
function aggregate4h(candles: OHLCV[]): OHLCV[] {
  if (candles.length === 0) return [];
  const out: OHLCV[] = [];
  for (let i = 0; i < candles.length; i += 4) {
    const block = candles.slice(i, Math.min(i + 4, candles.length));
    if (block.length === 0) continue;
    out.push({
      t: block[0].t,
      o: block[0].o,
      h: Math.max(...block.map((c) => c.h)),
      l: Math.min(...block.map((c) => c.l)),
      c: block[block.length - 1].c,
      v: block.reduce((s, c) => s + (c.v ?? 0), 0),
    });
  }
  return out;
}
