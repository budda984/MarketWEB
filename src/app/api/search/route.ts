import { NextResponse } from 'next/server';
import { yahooSearch, type YahooSearchResult } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=ferrari
 *
 * Ricerca per nome o simbolo su tutto il catalogo Yahoo. Il client la
 * affianca alla ricerca locale sull'universo, che resta istantanea: qui
 * arrivano i titoli che nell'universo non ci sono.
 *
 * Se Yahoo non risponde si restituisce una lista vuota con
 * unavailable=true invece di un errore: il client continua a mostrare
 * i risultati locali e nient'altro si rompe.
 */

// Cache in memoria: mentre si scrive, le stesse lettere tornano spesso
// (si cancella, si riscrive). Vive finche' l'istanza resta calda.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; results: YahooSearchResult[] }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ results: hit.results, cached: true });
  }

  const results = await yahooSearch(q, 10);
  if (results == null) {
    return NextResponse.json({ results: [], unavailable: true });
  }

  // Si toglie la voce piu' vecchia quando la cache e' piena: le Map
  // conservano l'ordine di inserimento.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), results });

  return NextResponse.json({ results });
}
