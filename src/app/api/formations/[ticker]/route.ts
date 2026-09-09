import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { yahooDownload } from '@/lib/yahoo';
import { detectFormations } from '@/lib/formations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/formations/AAPL — figure sul singolo titolo, per il grafico. */
export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  try {
    const candles = await yahooDownload(ticker, '1y', '1d');
    if (candles.length < 80) {
      return NextResponse.json({ formations: [] });
    }
    return NextResponse.json({ formations: detectFormations(ticker, candles) });
  } catch {
    return NextResponse.json({ formations: [] });
  }
}
