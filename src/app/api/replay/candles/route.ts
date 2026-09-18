import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadReplayData } from '@/lib/replay-data';
import type { BaseTf } from '@/lib/replay-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASES: BaseTf[] = ['1m', '5m', '1h', '1d'];

/**
 * GET /api/replay/candles?ticker=AAPL&base=5m
 * Restituisce tutto lo storico alla risoluzione base: e' il client a
 * nasconderne la parte "futura" in base al cursore del replay.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();
  const base = (url.searchParams.get('base') ?? '5m') as BaseTf;
  if (!ticker) return NextResponse.json({ error: 'Ticker mancante' }, { status: 400 });
  if (!BASES.includes(base)) return NextResponse.json({ error: 'Risoluzione non valida' }, { status: 400 });

  try {
    const data = await loadReplayData(ticker, base);
    if (data.bars.length === 0) {
      return NextResponse.json(
        { error: `Nessun dato ${base} per ${ticker}. Controlla il ticker o prova un'altra risoluzione.` },
        { status: 404 }
      );
    }
    // Formato compatto a tuple [t,o,h,l,c,v]: con l'1 minuto sulle crypto
    // si superano le 40.000 candele e le chiavi ripetute pesano
    const rows = data.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]);
    return NextResponse.json({
      ticker,
      base,
      gmtoffset: data.gmtoffset,
      currency: data.currency,
      name: data.name,
      rows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Yahoo non ha restituito dati per ${ticker}: ${e instanceof Error ? e.message : 'errore'}` },
      { status: 502 }
    );
  }
}
