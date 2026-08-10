/**
 * Client SEC EDGAR per i Form 4 (transazioni degli insider).
 *
 * I Form 4 sono depositati da dirigenti, consiglieri e detentori di oltre
 * il 10% entro due giorni lavorativi dall'operazione. Sono atti pubblici.
 *
 * REGOLE EDGAR (obbligatorie, altrimenti HTTP 403):
 *  - User-Agent descrittivo con un contatto email
 *  - massimo 10 richieste al secondo
 *
 * STRATEGIA: invece di interrogare 400 ticker uno per uno, si parte
 * dall'indice giornaliero (un file per giorno che elenca TUTTI i depositi)
 * e si filtrano solo i Form 4 degli emittenti che ci interessano. Da 400
 * richieste a una manciata.
 */

const UA = 'MarketMonitorPro/1.0 (budda984@gmail.com)';
const SEC_BASE = 'https://www.sec.gov';

/** Pausa fra le richieste per restare sotto i 10/sec di EDGAR. */
const REQUEST_DELAY_MS = 130;

async function secFetch(url: string, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Encoding': 'gzip, deflate',
      },
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// MAPPA TICKER -> CIK
// ============================================================================

export type TickerCik = { ticker: string; cik: string; name: string };

/**
 * Scarica la mappa ufficiale ticker -> CIK. Una sola richiesta (~1 MB).
 * Il CIK va usato senza zeri iniziali negli URL degli Archives.
 */
export async function fetchTickerCikMap(): Promise<Map<string, TickerCik>> {
  const res = await secFetch(`${SEC_BASE}/files/company_tickers.json`);
  if (!res.ok) throw new Error(`company_tickers.json HTTP ${res.status}`);
  const json = (await res.json()) as Record<
    string,
    { cik_str: number; ticker: string; title: string }
  >;
  const map = new Map<string, TickerCik>();
  for (const entry of Object.values(json)) {
    if (!entry?.ticker) continue;
    map.set(entry.ticker.toUpperCase(), {
      ticker: entry.ticker.toUpperCase(),
      cik: String(entry.cik_str),
      name: entry.title,
    });
  }
  return map;
}

// ============================================================================
// INDICE GIORNALIERO
// ============================================================================

export type DailyIndexEntry = {
  cik: string;
  companyName: string;
  formType: string;
  dateFiled: string;
  /** es. edgar/data/320193/0000320193-24-000123.txt */
  fileName: string;
  accession: string;
};

function quarterOf(d: Date): number {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Scarica l'indice di un singolo giorno e ritorna solo i Form 4.
 * Ritorna array vuoto se il giorno non ha indice (weekend, festivi).
 *
 * master.idx e' delimitato da pipe: CIK|Nome|Tipo|Data|File
 */
export async function fetchForm4Index(
  date: Date
): Promise<DailyIndexEntry[]> {
  const y = date.getUTCFullYear();
  const q = quarterOf(date);
  const url = `${SEC_BASE}/Archives/edgar/daily-index/${y}/QTR${q}/master.${yyyymmdd(date)}.idx`;

  const res = await secFetch(url);
  if (!res.ok) return []; // giorno non lavorativo o indice non disponibile

  const text = await res.text();
  const out: DailyIndexEntry[] = [];

  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const [cik, companyName, formType, dateFiled, fileName] = parts.map((p) =>
      p.trim()
    );
    if (formType !== '4') continue;

    // edgar/data/320193/0000320193-24-000123.txt -> accession
    const m = fileName.match(/([0-9]{10}-[0-9]{2}-[0-9]{6})\.txt$/);
    if (!m) continue;

    out.push({
      cik,
      companyName,
      formType,
      dateFiled,
      fileName,
      accession: m[1],
    });
  }
  return out;
}

/** Ultimi N giorni di calendario, dal piu' recente. */
export function recentDates(days: number, endDate = new Date()): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(
      Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate() - i
      )
    );
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // salta weekend
    out.push(d);
  }
  return out;
}

// ============================================================================
// PARSING FORM 4
// ============================================================================

export type InsiderTransaction = {
  accession: string;
  rowIdx: number;
  filingUrl: string;
  issuerCik: string;
  ticker: string | null;
  issuerName: string | null;
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercent: boolean;
  transactionDate: string | null;
  filedDate: string | null;
  transactionCode: string | null;
  acquiredDisposed: string | null;
  securityTitle: string | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
  isDerivative: boolean;
};

/** Estrae il contenuto del primo tag corrispondente. */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Molti campi Form 4 sono annidati: <campo><value>X</value></campo> */
function tagValue(xml: string, name: string): string | null {
  const block = tag(xml, name);
  if (block == null) return null;
  const inner = tag(block, 'value');
  return (inner ?? block).replace(/<[^>]+>/g, '').trim() || null;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function allBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * Estrae le transazioni da un Form 4.
 *
 * Lo schema SEC ha diverse varianti: il parsing e' volutamente difensivo,
 * un deposito che non si interpreta viene saltato invece di far fallire
 * l'intera sincronizzazione.
 */
export function parseForm4(
  rawSubmission: string,
  meta: { accession: string; filedDate: string; filingUrl: string }
): InsiderTransaction[] {
  // Nel file .txt completo l'XML e' incapsulato: isolo ownershipDocument
  const docMatch = rawSubmission.match(
    /<ownershipDocument>([\s\S]*?)<\/ownershipDocument>/i
  );
  if (!docMatch) return [];
  const doc = docMatch[1];

  const issuerBlock = tag(doc, 'issuer') ?? '';
  const issuerCik = tagValue(issuerBlock, 'issuerCik') ?? '';
  const ticker = tagValue(issuerBlock, 'issuerTradingSymbol');
  const issuerName = tagValue(issuerBlock, 'issuerName');

  const ownerBlock = tag(doc, 'reportingOwner') ?? '';
  const ownerId = tag(ownerBlock, 'reportingOwnerId') ?? '';
  const ownerName = tagValue(ownerId, 'rptOwnerName') ?? 'Sconosciuto';
  const rel = tag(ownerBlock, 'reportingOwnerRelationship') ?? '';
  const isDirector = (tagValue(rel, 'isDirector') ?? '0') === '1';
  const isOfficer = (tagValue(rel, 'isOfficer') ?? '0') === '1';
  const isTenPercent = (tagValue(rel, 'isTenPercentOwner') ?? '0') === '1';
  const ownerTitle = tagValue(rel, 'officerTitle');

  const out: InsiderTransaction[] = [];
  let rowIdx = 0;

  function pushFrom(blocks: string[], isDerivative: boolean) {
    for (const b of blocks) {
      const coding = tag(b, 'transactionCoding') ?? '';
      const amounts = tag(b, 'transactionAmounts') ?? '';
      const post = tag(b, 'postTransactionAmounts') ?? '';

      const shares = num(tagValue(amounts, 'transactionShares'));
      const price = num(tagValue(amounts, 'transactionPricePerShare'));
      const code = tagValue(coding, 'transactionCode');

      out.push({
        accession: meta.accession,
        rowIdx: rowIdx++,
        filingUrl: meta.filingUrl,
        issuerCik,
        ticker: ticker ? ticker.toUpperCase() : null,
        issuerName,
        ownerName,
        ownerTitle,
        isDirector,
        isOfficer,
        isTenPercent,
        transactionDate: tagValue(b, 'transactionDate'),
        filedDate: meta.filedDate,
        transactionCode: code,
        acquiredDisposed: tagValue(amounts, 'transactionAcquiredDisposedCode'),
        securityTitle: tagValue(b, 'securityTitle'),
        shares,
        price,
        value: shares != null && price != null ? shares * price : null,
        sharesOwnedAfter: num(
          tagValue(post, 'sharesOwnedFollowingTransaction')
        ),
        isDerivative,
      });
    }
  }

  pushFrom(allBlocks(doc, 'nonDerivativeTransaction'), false);
  pushFrom(allBlocks(doc, 'derivativeTransaction'), true);

  return out;
}

/** Scarica il file di submission completo e ne estrae le transazioni. */
export async function fetchAndParseForm4(
  entry: DailyIndexEntry
): Promise<InsiderTransaction[]> {
  const url = `${SEC_BASE}/Archives/${entry.fileName}`;
  const res = await secFetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  const cikNoPad = String(Number(entry.cik));
  const accNoDash = entry.accession.replace(/-/g, '');
  return parseForm4(text, {
    accession: entry.accession,
    filedDate: formatIndexDate(entry.dateFiled),
    filingUrl: `${SEC_BASE}/Archives/edgar/data/${cikNoPad}/${accNoDash}/${entry.accession}-index.htm`,
  });
}

/** L'indice usa yyyy-mm-dd oppure yyyymmdd a seconda del file. */
function formatIndexDate(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

export { sleep, REQUEST_DELAY_MS };
