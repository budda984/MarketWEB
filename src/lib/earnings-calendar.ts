/**
 * Calendario delle trimestrali da Yahoo.
 *
 * Usa l'endpoint "visualization", lo stesso che alimenta la pagina del
 * calendario di Yahoo: e' un POST e richiede la sessione con crumb.
 * Restituisce molte societa' in una sola richiesta, quindi e' molto piu'
 * efficiente che interrogare i titoli uno per uno.
 *
 * Le date qui sono ANNUNCIATE dalle aziende, non stimate: sostituiscono
 * la stima basata sulla cadenza dei depositi.
 */

import { yahooAuthedFetch } from './yahoo';

export type EarningsEvent = {
  ticker: string;
  company: string | null;
  /** Data dell'annuncio, in formato ISO */
  date: string;
  /** Momento della giornata dichiarato da Yahoo, quando disponibile */
  timing: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
};

type VizResponse = {
  finance?: {
    result?: Array<{
      documents?: Array<{
        columns?: Array<{ id?: string }>;
        rows?: unknown[][];
      }>;
    }>;
  };
};

/**
 * Scarica un intervallo di date. `size` e' limitato da Yahoo: per
 * finestre ampie si pagina con `offset`.
 */
export async function fetchEarningsCalendar(
  fromDate: string,
  toDate: string,
  size = 100,
  offset = 0
): Promise<EarningsEvent[]> {
  const res = await yahooAuthedFetch(
    (crumb) =>
      `https://query1.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size,
        offset,
        sortField: 'startdatetime',
        sortType: 'ASC',
        entityIdType: 'earnings',
        includeFields: [
          'ticker',
          'companyshortname',
          'startdatetime',
          'startdatetimetype',
          'epsestimate',
          'epsactual',
          'epssurprisepct',
        ],
        query: {
          operator: 'and',
          operands: [
            { operator: 'gte', operands: ['startdatetime', fromDate] },
            { operator: 'lt', operands: ['startdatetime', toDate] },
            { operator: 'eq', operands: ['region', 'us'] },
          ],
        },
      }),
    },
    15000
  );

  if (!res || !res.ok) return [];

  let json: VizResponse;
  try {
    json = (await res.json()) as VizResponse;
  } catch {
    return [];
  }

  const doc = json?.finance?.result?.[0]?.documents?.[0];
  const columns = doc?.columns ?? [];
  const rows = doc?.rows ?? [];
  if (columns.length === 0 || rows.length === 0) return [];

  // Le colonne arrivano come elenco ordinato: costruisco l'indice per
  // nome invece di fidarmi della posizione, che potrebbe cambiare
  const idx: Record<string, number> = {};
  columns.forEach((c, i) => {
    if (c?.id) idx[c.id] = i;
  });

  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const ticker = row[idx.ticker];
    const when = row[idx.startdatetime];
    if (typeof ticker !== 'string' || !when) continue;

    const date = String(when).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    out.push({
      ticker: ticker.toUpperCase(),
      company:
        typeof row[idx.companyshortname] === 'string'
          ? (row[idx.companyshortname] as string)
          : null,
      date,
      timing:
        typeof row[idx.startdatetimetype] === 'string'
          ? (row[idx.startdatetimetype] as string)
          : null,
      epsEstimate: num(row[idx.epsestimate]),
      epsActual: num(row[idx.epsactual]),
      surprisePct: num(row[idx.epssurprisepct]),
    });
  }
  return out;
}

/** Etichetta leggibile del momento della giornata. */
export function timingLabel(t: string | null): string | null {
  if (!t) return null;
  const s = t.toUpperCase();
  if (s.includes('BMO') || s.includes('BEFORE')) return 'prima dell\u2019apertura';
  if (s.includes('AMC') || s.includes('AFTER')) return 'dopo la chiusura';
  if (s.includes('TAS') || s.includes('DURING')) return 'durante la seduta';
  return null;
}
