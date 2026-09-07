/**
 * Giudizio di valutazione a partire dai bilanci depositati alla SEC.
 *
 * COSA DICE E COSA NON DICE
 * Risponde a "questo titolo costa piu' o meno di come e' stato valutato
 * in passato". Non risponde a "salira'": nessun dato di bilancio lo fa.
 *
 * PERCHE' DUE DIMENSIONI E NON UNA
 * Un'etichetta unica come "sottovalutato" nasconde il caso piu' comune e
 * piu' insidioso: un titolo a sconto perche' i suoi utili stanno
 * calando. Il giudizio tiene quindi insieme quanto costa e come sta
 * andando l'azienda, perche' e' la combinazione a essere informativa.
 */

import type { OHLCV } from './yahoo';

const UA = 'MarketMonitorPro/1.0 (budda984@gmail.com)';
const SEC_DATA = 'https://data.sec.gov';

export const SEC_DELAY_MS = 200; // ~5 richieste al secondo, sotto il limite di 10

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type ConceptFact = {
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  start?: string;
  frame?: string;
};

async function fetchConcept(
  cik: string,
  concept: string,
  unit: string,
  timeoutMs = 12000
): Promise<ConceptFact[] | null> {
  const padded = cik.padStart(10, '0');
  const url = `${SEC_DATA}/api/xbrl/companyconcept/CIK${padded}/us-gaap/${concept}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      units?: Record<string, ConceptFact[]>;
    };
    return json?.units?.[unit] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prova piu' etichette in sequenza: le aziende non usano tutte lo stesso
 * nome XBRL per la stessa voce.
 */
async function fetchFirstAvailable(
  cik: string,
  concepts: string[],
  unit: string
): Promise<ConceptFact[] | null> {
  for (const c of concepts) {
    const r = await fetchConcept(cik, c, unit);
    if (r && r.length > 0) return r;
    await sleep(SEC_DELAY_MS);
  }
  return null;
}

/** Tiene solo i dati trimestrali o annuali, il piu' recente per periodo. */
function quarterlySeries(facts: ConceptFact[]): ConceptFact[] {
  const byEnd = new Map<string, ConceptFact>();
  for (const f of facts) {
    if (!Number.isFinite(f.val)) continue;
    // I 10-Q coprono un trimestre, i 10-K l'anno: per le voci di flusso
    // servono periodi omogenei, quindi si scartano quelli lunghi
    if (f.start) {
      const days =
        (new Date(f.end).getTime() - new Date(f.start).getTime()) / 86400000;
      if (days > 100) continue; // solo periodi trimestrali
    }
    const prev = byEnd.get(f.end);
    if (!prev || (f.form === '10-K' && prev.form !== '10-K')) {
      byEnd.set(f.end, f);
    }
  }
  return Array.from(byEnd.values()).sort((a, b) => a.end.localeCompare(b.end));
}

/** Somma degli ultimi quattro trimestri terminanti entro `asOf`. */
function ttmAt(series: ConceptFact[], asOf: string): number | null {
  const upTo = series.filter((f) => f.end <= asOf);
  if (upTo.length < 4) return null;
  const last4 = upTo.slice(-4);
  const sum = last4.reduce((s, f) => s + f.val, 0);
  return Number.isFinite(sum) ? sum : null;
}

export type Fundamentals = {
  ticker: string;
  ttmEps: number | null;
  ttmEpsYearAgo: number | null;
  ttmRevenue: number | null;
  ttmRevenueYearAgo: number | null;
  netMargin: number | null;
  netMarginYearAgo: number | null;
  epsGrowthPct: number | null;
  revenueGrowthPct: number | null;
  marginChangePct: number | null;
  currentPe: number | null;
  medianPe: number | null;
  /** Scostamento del multiplo attuale dalla mediana storica */
  peDiscountPct: number | null;
  price: number | null;
  lastReportDate: string | null;
  quartersAvailable: number;
};

/**
 * Scarica i bilanci e li incrocia con i prezzi storici per ricostruire
 * la serie dei multipli.
 */
export async function fetchFundamentals(
  ticker: string,
  cik: string,
  candles: OHLCV[]
): Promise<Fundamentals | null> {
  const epsFacts = await fetchFirstAvailable(
    cik,
    ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    'USD/shares'
  );
  await sleep(SEC_DELAY_MS);

  const revFacts = await fetchFirstAvailable(
    cik,
    [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
    ],
    'USD'
  );
  await sleep(SEC_DELAY_MS);

  const niFacts = await fetchConcept(cik, 'NetIncomeLoss', 'USD');

  const eps = epsFacts ? quarterlySeries(epsFacts) : [];
  const rev = revFacts ? quarterlySeries(revFacts) : [];
  const ni = niFacts ? quarterlySeries(niFacts) : [];

  if (eps.length < 4 && rev.length < 4) return null;

  const lastReportDate =
    eps.length > 0 ? eps[eps.length - 1].end : rev.length > 0 ? rev[rev.length - 1].end : null;
  if (!lastReportDate) return null;

  const yearAgo = new Date(
    new Date(lastReportDate).getTime() - 365 * 86400000
  )
    .toISOString()
    .slice(0, 10);

  const ttmEps = ttmAt(eps, lastReportDate);
  const ttmEpsYearAgo = ttmAt(eps, yearAgo);
  const ttmRevenue = ttmAt(rev, lastReportDate);
  const ttmRevenueYearAgo = ttmAt(rev, yearAgo);
  const ttmNi = ttmAt(ni, lastReportDate);
  const ttmNiYearAgo = ttmAt(ni, yearAgo);

  const netMargin =
    ttmNi != null && ttmRevenue != null && ttmRevenue > 0
      ? (ttmNi / ttmRevenue) * 100
      : null;
  const netMarginYearAgo =
    ttmNiYearAgo != null && ttmRevenueYearAgo != null && ttmRevenueYearAgo > 0
      ? (ttmNiYearAgo / ttmRevenueYearAgo) * 100
      : null;

  const price = candles.length > 0 ? candles[candles.length - 1].c : null;

  // Serie storica del rapporto prezzo/utili: per ogni trimestre, il
  // prezzo di allora diviso l'utile dei dodici mesi precedenti. E' il
  // metro di paragone con cui si giudica il multiplo attuale.
  const peHistory: number[] = [];
  for (const q of eps) {
    const ttm = ttmAt(eps, q.end);
    if (ttm == null || ttm <= 0) continue;
    const target = new Date(q.end).getTime() / 1000;
    let closest: OHLCV | null = null;
    let bestDiff = Infinity;
    for (const c of candles) {
      const d = Math.abs(c.t - target);
      if (d < bestDiff) {
        bestDiff = d;
        closest = c;
      }
    }
    // Solo se esiste un prezzo entro dieci giorni dalla chiusura contabile
    if (!closest || bestDiff > 10 * 86400) continue;
    const pe = closest.c / ttm;
    if (Number.isFinite(pe) && pe > 0 && pe < 300) peHistory.push(pe);
  }

  peHistory.sort((a, b) => a - b);
  const medianPe =
    peHistory.length >= 6
      ? peHistory.length % 2 === 1
        ? peHistory[(peHistory.length - 1) / 2]
        : (peHistory[peHistory.length / 2 - 1] + peHistory[peHistory.length / 2]) / 2
      : null;

  const currentPe =
    price != null && ttmEps != null && ttmEps > 0 ? price / ttmEps : null;

  return {
    ticker,
    ttmEps,
    ttmEpsYearAgo,
    ttmRevenue,
    ttmRevenueYearAgo,
    netMargin,
    netMarginYearAgo,
    epsGrowthPct:
      ttmEps != null && ttmEpsYearAgo != null && ttmEpsYearAgo > 0
        ? ((ttmEps - ttmEpsYearAgo) / Math.abs(ttmEpsYearAgo)) * 100
        : null,
    revenueGrowthPct:
      ttmRevenue != null && ttmRevenueYearAgo != null && ttmRevenueYearAgo > 0
        ? ((ttmRevenue - ttmRevenueYearAgo) / ttmRevenueYearAgo) * 100
        : null,
    marginChangePct:
      netMargin != null && netMarginYearAgo != null
        ? netMargin - netMarginYearAgo
        : null,
    currentPe,
    medianPe,
    peDiscountPct:
      currentPe != null && medianPe != null && medianPe > 0
        ? ((medianPe - currentPe) / medianPe) * 100
        : null,
    price,
    lastReportDate,
    quartersAvailable: Math.max(eps.length, rev.length),
  };
}

// ============================================================================
// GIUDIZIO
// ============================================================================

export type VerdictLevel =
  | 'occasione'
  | 'sconto_con_riserva'
  | 'in_linea'
  | 'caro_ma_in_crescita'
  | 'caro'
  | 'non_valutabile';

export type Verdict = {
  level: VerdictLevel;
  /** Frase sintetica, quella che si legge per prima */
  headline: string;
  /** I due fatti da cui discende il giudizio */
  reasons: string[];
  /** Positivo = a sconto rispetto alla propria storia */
  discountPct: number | null;
};

export function buildVerdict(f: Fundamentals): Verdict {
  const reasons: string[] = [];

  // Senza multiplo attuale o senza storia non ci si esprime: e' meglio
  // dirlo che produrre un giudizio su basi insufficienti
  if (f.currentPe == null || f.medianPe == null) {
    const why =
      f.ttmEps != null && f.ttmEps <= 0
        ? "l'azienda e' in perdita sugli ultimi dodici mesi"
        : 'i dati di bilancio disponibili non bastano';
    return {
      level: 'non_valutabile',
      headline: 'Non valutabile',
      reasons: [`Nessun confronto possibile: ${why}.`],
      discountPct: null,
    };
  }

  const disc = f.peDiscountPct ?? 0;
  reasons.push(
    `Tratta a ${f.currentPe.toFixed(1)} volte gli utili, contro una mediana storica di ${f.medianPe.toFixed(1)}.`
  );

  // Andamento dell'azienda: utili in primo piano, fatturato e margine a
  // corredo
  const epsG = f.epsGrowthPct;
  const revG = f.revenueGrowthPct;
  const margC = f.marginChangePct;

  const trendBits: string[] = [];
  if (revG != null) {
    trendBits.push(
      `fatturato ${revG >= 0 ? 'in crescita' : 'in calo'} del ${Math.abs(revG).toFixed(0)}%`
    );
  }
  if (epsG != null) {
    trendBits.push(
      `utili ${epsG >= 0 ? 'in crescita' : 'in calo'} del ${Math.abs(epsG).toFixed(0)}%`
    );
  }
  if (margC != null && Math.abs(margC) >= 0.5) {
    trendBits.push(
      `margine ${margC >= 0 ? 'in miglioramento' : 'in peggioramento'} di ${Math.abs(margC).toFixed(1)} punti`
    );
  }
  if (trendBits.length > 0) {
    reasons.push(`Sull'ultimo anno: ${trendBits.join(', ')}.`);
  } else {
    reasons.push("Andamento dell'azienda non ricostruibile dai dati depositati.");
  }

  // Deterioramento: utili in calo, oppure margine in forte contrazione
  const deteriorating =
    (epsG != null && epsG < -5) || (margC != null && margC < -2);
  const growing =
    (epsG != null && epsG > 10) || (revG != null && revG > 10);

  const cheap = disc >= 15;
  const expensive = disc <= -15;

  let level: VerdictLevel;
  let headline: string;

  if (cheap && deteriorating) {
    level = 'sconto_con_riserva';
    headline = 'A sconto, ma i conti stanno peggiorando';
  } else if (cheap) {
    level = 'occasione';
    headline = 'A sconto rispetto alla propria storia';
  } else if (expensive && growing) {
    level = 'caro_ma_in_crescita';
    headline = 'Caro, ma con i conti in crescita';
  } else if (expensive) {
    level = 'caro';
    headline = 'Piu' + '\u0300' + ' caro del solito';
  } else {
    level = 'in_linea';
    headline = 'In linea con la propria valutazione storica';
  }

  return { level, headline, reasons, discountPct: f.peDiscountPct };
}
