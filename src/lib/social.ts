/**
 * Menzioni dei ticker sulle community di Reddit, via ApeWisdom.
 *
 * PERCHE' REDDIT E NON TWITTER
 * Dal 6 febbraio 2026 X ha eliminato il piano gratuito e fattura a
 * consumo (~0,005 $ per post letto): contare le menzioni richiederebbe
 * migliaia di letture al giorno, nell'ordine di oltre 1.000 $ al mese.
 * ApeWisdom espone gli stessi conteggi su Reddit gratuitamente e senza
 * chiave.
 *
 * COME LEGGE I DATI
 * Le community vengono scansionate due volte l'ora; i ticker sono
 * riconosciuti dal formato maiuscolo o dal prefisso $; menzioni
 * ripetute nello stesso messaggio contano una volta sola.
 */

export type SocialFilter =
  | 'all'
  | 'all-stocks'
  | 'all-crypto'
  | 'wallstreetbets'
  | 'stocks'
  | 'options'
  | 'investing'
  | 'Daytrading'
  | 'SPACs'
  | '4chan';

export const SOCIAL_FILTERS: Array<{ value: SocialFilter; label: string }> = [
  { value: 'all-stocks', label: 'Tutte le community azionarie' },
  { value: 'wallstreetbets', label: 'r/wallstreetbets' },
  { value: 'stocks', label: 'r/stocks' },
  { value: 'options', label: 'r/options' },
  { value: 'investing', label: 'r/investing' },
  { value: 'Daytrading', label: 'r/Daytrading' },
  { value: 'SPACs', label: 'r/SPACs' },
  { value: 'all-crypto', label: 'Community crypto' },
  { value: 'all', label: 'Tutto (azioni + crypto)' },
];

export type SocialMention = {
  rank: number;
  ticker: string;
  name: string | null;
  mentions: number;
  mentions24hAgo: number | null;
  rank24hAgo: number | null;
  upvotes: number | null;
  /** Variazione percentuale delle menzioni sulle 24 ore */
  mentionsChangePct: number | null;
  /** Posizioni guadagnate in classifica (positivo = salito) */
  rankChange: number | null;
};

/** I campi numerici arrivano come stringhe: conversione difensiva. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

type ApeResponse = {
  count?: number;
  pages?: number;
  current_page?: number;
  results?: Array<Record<string, unknown>>;
};

/**
 * Scarica una pagina di risultati (100 ticker per pagina).
 * Lancia un errore con messaggio leggibile in caso di problemi.
 */
export async function fetchSocialMentions(
  filter: SocialFilter = 'all-stocks',
  page = 1,
  timeoutMs = 12000
): Promise<{ mentions: SocialMention[]; totalPages: number; total: number }> {
  const url = `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(
    filter
  )}/page/${page}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'MarketMonitorPro/1.0',
        Accept: 'application/json',
      },
      signal: ctrl.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`ApeWisdom ha risposto HTTP ${res.status}`);
    }

    const text = await res.text();
    if (!text) throw new Error('Risposta vuota da ApeWisdom');

    let json: ApeResponse;
    try {
      json = JSON.parse(text) as ApeResponse;
    } catch {
      throw new Error('Risposta non interpretabile da ApeWisdom');
    }

    const rows = Array.isArray(json.results) ? json.results : [];
    const mentions: SocialMention[] = [];

    for (const r of rows) {
      const ticker = typeof r.ticker === 'string' ? r.ticker.toUpperCase() : null;
      if (!ticker) continue;

      const m = toNum(r.mentions) ?? 0;
      const m24 = toNum(r.mentions_24h_ago);
      const rk = toNum(r.rank) ?? 0;
      const rk24 = toNum(r.rank_24h_ago);

      mentions.push({
        rank: rk,
        ticker,
        name: typeof r.name === 'string' ? r.name : null,
        mentions: m,
        mentions24hAgo: m24,
        rank24hAgo: rk24,
        upvotes: toNum(r.upvotes),
        // Se ieri il ticker non compariva, la variazione non e'
        // calcolabile: meglio null che un +100% arbitrario
        mentionsChangePct:
          m24 != null && m24 > 0 ? ((m - m24) / m24) * 100 : null,
        // In classifica il numero piu' basso e' migliore: inverto il
        // segno perche' un valore positivo significhi "salito"
        rankChange: rk24 != null && rk > 0 ? rk24 - rk : null,
      });
    }

    return {
      mentions,
      totalPages: toNum(json.pages) ?? 1,
      total: toNum(json.count) ?? mentions.length,
    };
  } finally {
    clearTimeout(timer);
  }
}
