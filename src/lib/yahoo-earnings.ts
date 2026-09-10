/**
 * Calendario delle trimestrali da Yahoo.
 *
 * L'endpoint e' lo stesso che alimenta la pagina "Earnings" del sito:
 * accetta POST con una query strutturata e restituisce righe e colonne
 * separate, quindi i valori vanno riassociati ai nomi delle colonne
 * invece di essere letti per posizione.
 *
 * Richiede la sessione (cookie + crumb): senza risponde 401.
 */

import { yahooAuthedFetch } from './yahoo';

export type EarningsEvent = {
  ticker: string;
  company: string | null;
  /** Data dell'evento, formato ISO */
  date: string;
  /** Prima dell'apertura, dopo la chiusura, orario non specificato */
  timing: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
};

const FIELDS = [
  'ticker',
  'companyshortname',
  'startdatetime',
  'startdatetimetype',
  'epsestimate',
  'epsactual',
  'epssurprisepct',
];

/** Le sigle di Yahoo per il momento della pubblicazione. */
function readTiming(v: unknown): string | null {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  if (s === 'BMO') return 'prima dell\u2019apertura';
  if (s === 'AMC') return 'dopo la chiusura';
  if (s === 'TAS') return 'orario non comunicato';
  return null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Scarica gli eventi in un intervallo di date. Yahoo limita la
 * dimensione della pagina, quindi si scorre finche' restituisce righe.
 */
export async function fetchEarningsCalendar(
  fromDate: string,
  toDate: string,
  maxPages = 6,
  pageSize = 250
): Promise<{ events: EarningsEvent[]; error: string | null }> {
  const events: EarningsEvent[] = [];

  for (let page = 0; page < maxPages; page++) {
    const res = await yahooAuthedFetch(
      (crumb) =>
        `https://query1.finance.yahoo.com/v1/finance/visualization` +
        `?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size: pageSize,
          offset: page * pageSize,
          sortField: 'startdatetime',
          sortType: 'ASC',
          entityIdType: 'earnings',
          includeFields: FIELDS,
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

    if (!res) return { events, error: 'Yahoo non raggiungibile.' };
    if (!res.ok) {
      return {
        events,
        error: `Yahoo ha risposto HTTP ${res.status} al calendario.`,
      };
    }

    const text = await res.text();
    if (!text) break;

    let json: {
      finance?: {
        result?: Array<{
          documents?: Array<{
            columns?: Array<{ id?: string }>;
            rows?: unknown[][];
          }>;
        }>;
      };
    };
    try {
      json = JSON.parse(text);
    } catch {
      return { events, error: 'Risposta non interpretabile.' };
    }

    const doc = json?.finance?.result?.[0]?.documents?.[0];
    const columns = (doc?.columns ?? []).map((c) => c?.id ?? '');
    const rows = doc?.rows ?? [];
    if (rows.length === 0) break;

    // I valori arrivano per posizione: vanno riassociati ai nomi delle
    // colonne, che Yahoo puo' riordinare senza preavviso
    const idx = (name: string) => columns.indexOf(name);
    const iTicker = idx('ticker');
    const iName = idx('companyshortname');
    const iDate = idx('startdatetime');
    const iType = idx('startdatetimetype');
    const iEst = idx('epsestimate');
    const iAct = idx('epsactual');
    const iSur = idx('epssurprisepct');

    if (iTicker < 0 || iDate < 0) {
      return { events, error: 'Colonne inattese nella risposta.' };
    }

    for (const row of rows) {
      const tk = row[iTicker];
      const dt = row[iDate];
      if (typeof tk !== 'string' || dt == null) continue;
      const iso = String(dt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;

      events.push({
        ticker: tk.toUpperCase(),
        company: iName >= 0 && typeof row[iName] === 'string' ? (row[iName] as string) : null,
        date: iso,
        timing: iType >= 0 ? readTiming(row[iType]) : null,
        epsEstimate: iEst >= 0 ? num(row[iEst]) : null,
        epsActual: iAct >= 0 ? num(row[iAct]) : null,
        surprisePct: iSur >= 0 ? num(row[iSur]) : null,
      });
    }

    if (rows.length < pageSize) break;
  }

  return { events, error: null };
}
