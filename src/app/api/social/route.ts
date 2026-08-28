import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ALL_TICKERS, getMarketForTicker } from '@/lib/tickers';
import {
  fetchSocialMentions,
  type SocialFilter,
  type SocialMention,
} from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Cache in memoria: ApeWisdom aggiorna due volte l'ora, quindi
 * interrogarlo a ogni apertura della pagina e' inutile. Su serverless la
 * cache non sopravvive ai riavvii a freddo, ma copre le riletture
 * ravvicinate che sono il caso frequente.
 */
type CacheEntry = { at: number; payload: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15 * 60 * 1000;

const KNOWN = new Set(ALL_TICKERS.map((t) => t.toUpperCase()));

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filter = (url.searchParams.get('filter') ?? 'all-stocks') as SocialFilter;
  const pages = Math.min(Number(url.searchParams.get('pages') ?? 1), 3);
  const force = url.searchParams.get('force') === '1';

  const key = `${filter}|${pages}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({
      ...(hit.payload as object),
      cached: true,
      cacheAgeSec: Math.round((Date.now() - hit.at) / 1000),
    });
  }

  try {
    const all: SocialMention[] = [];
    let totalPages = 1;
    let total = 0;

    for (let p = 1; p <= pages; p++) {
      const res = await fetchSocialMentions(filter, p);
      all.push(...res.mentions);
      totalPages = res.totalPages;
      total = res.total;
      if (p >= res.totalPages) break;
    }

    // Segnalo quali ticker sono gia' nel sistema: per gli altri il
    // grafico non e' disponibile
    const enriched = all.map((m) => ({
      ...m,
      tracked: KNOWN.has(m.ticker),
      market: getMarketForTicker(m.ticker),
    }));

    const payload = {
      filter,
      mentions: enriched,
      totalPages,
      total,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), payload });

    return NextResponse.json({ ...payload, cached: false });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `Impossibile leggere i dati social: ${e.message}`
            : 'Errore sconosciuto',
      },
      { status: 502 }
    );
  }
}
