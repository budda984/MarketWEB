/**
 * Scarico dello storico per il Replay, direttamente da Yahoo /v8/chart.
 *
 * Limiti di Yahoo per risoluzione:
 * - 1m: solo ultimi 30 giorni e massimo 8 giorni per richiesta,
 *   quindi scarico 4 blocchi da 7 giorni e li unisco
 * - 5m: ultimi 60 giorni
 * - 1h: ultimi 730 giorni
 * - 1d: storico lungo (qui 10 anni)
 */
import type { Bar, BaseTf } from './replay-engine';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type ChartJson = {
  chart?: {
    result?: Array<{
      meta?: { gmtoffset?: number; currency?: string; exchangeName?: string; shortName?: string; longName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

export type ReplayData = {
  bars: Bar[];
  gmtoffset: number;
  currency: string | null;
  name: string | null;
};

async function fetchChart(ticker: string, query: string, timeoutMs = 15000) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?${query}&includePrePost=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as ChartJson | null;
    if (!res.ok) {
      const msg = json?.chart?.error?.description ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json?.chart?.result?.[0] ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function toBars(result: NonNullable<Awaited<ReturnType<typeof fetchChart>>>): Bar[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ t: ts[i], o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return out;
}

export async function loadReplayData(ticker: string, base: BaseTf): Promise<ReplayData> {
  let results: NonNullable<Awaited<ReturnType<typeof fetchChart>>>[] = [];

  if (base === '1m') {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    // Il blocco piu' vecchio parte da 29 giorni fa: al limite dei 30 Yahoo rifiuta
    const windows: [number, number][] = [
      [now - 7 * day, now],
      [now - 14 * day, now - 7 * day],
      [now - 21 * day, now - 14 * day],
      [now - 29 * day, now - 21 * day],
    ];
    const settled = await Promise.allSettled(
      windows.map(([a, b]) => fetchChart(ticker, `period1=${a}&period2=${b}&interval=1m`))
    );
    for (const s of settled) if (s.status === 'fulfilled' && s.value) results.push(s.value);
    if (results.length === 0) {
      const firstErr = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(firstErr ? String(firstErr.reason?.message ?? firstErr.reason) : 'nessun dato');
    }
  } else {
    const query =
      base === '5m'
        ? 'range=59d&interval=5m'
        : base === '1h'
          ? 'range=729d&interval=1h'
          : 'range=10y&interval=1d';
    const r = await fetchChart(ticker, query);
    if (r) results = [r];
  }

  const meta = results[0]?.meta ?? {};
  const gmtoffset = meta.gmtoffset ?? 0;

  // Unisco, ordino e tolgo i duplicati ai bordi dei blocchi
  const map = new Map<number, Bar>();
  for (const r of results) for (const b of toBars(r)) map.set(b.t, b);
  const bars = Array.from(map.values())
    .sort((a, b) => a.t - b.t)
    // Ora di borsa: il grafico mostra l'orario locale della piazza
    .map((b) => ({ ...b, t: b.t + gmtoffset }));

  return {
    bars,
    gmtoffset,
    currency: meta.currency ?? null,
    name: meta.shortName ?? meta.longName ?? null,
  };
}
