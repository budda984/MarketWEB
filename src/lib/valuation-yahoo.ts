/**
 * Valutazione dai bilanci Yahoo, per i titoli che la SEC non copre:
 * mercati non USA e societa' estere quotate in America che depositano
 * in IFRS (ASML, TSM...), per cui le serie us-gaap sono vuote.
 *
 * Il metodo e' lo stesso di valuation.ts: multiplo attuale contro la
 * mediana dei multipli passati, piu' l'andamento dell'azienda. Cambia
 * da dove arrivano i numeri, e ci sono due complicazioni che con la SEC
 * non esistono.
 *
 * VALUTE
 * Prezzo e bilancio possono essere in valute diverse: Londra quota in
 * pence (GBp) ma molte societa' inglesi redigono in dollari; le
 * giapponesi quotate in USA hanno il bilancio in yen. Si porta tutto
 * nella valuta del prezzo, col cambio della data di ogni punto.
 *
 * DATI PIU' CORTI
 * Yahoo da' pochi trimestri e qualche anno. Dove mancano quattro
 * trimestri consecutivi (molte europee pubblicano solo semestrali) si
 * usa l'utile dell'ultimo esercizio chiuso.
 */

import { yahooDownload, yahooQuote, type OHLCV } from './yahoo';
import {
  fetchYahooFinancials,
  fetchYahooProfile,
  type SeriesPoint,
  type YahooFinancials,
} from './yahoo-fundamentals';
import type { Fundamentals, QuarterReport } from './valuation';

const DAY = 86400000;

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY;
}

function isoMinusDays(d: string, n: number): string {
  return new Date(new Date(d).getTime() - n * DAY).toISOString().slice(0, 10);
}

/** Fine del mese di `months` mesi prima: allinea le date alle chiusure trimestrali */
function monthEndMinus(d: string, months: number): string {
  const dt = new Date(d + 'T00:00:00Z');
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() - months;
  // Giorno 0 del mese successivo = ultimo giorno del mese voluto
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Valute
// ----------------------------------------------------------------------------

/**
 * Alcune borse quotano in centesimi. Il codice Yahoo lo segnala con la
 * minuscola (GBp) o con un codice a parte: si riporta alla valuta intera.
 */
const MINOR_UNITS: Record<string, { currency: string; divisor: number }> = {
  GBp: { currency: 'GBP', divisor: 100 },
  GBX: { currency: 'GBP', divisor: 100 },
  ILA: { currency: 'ILS', divisor: 100 },
  ZAc: { currency: 'ZAR', divisor: 100 },
  ZAC: { currency: 'ZAR', divisor: 100 },
};

function normalizeCurrency(raw: string | null): {
  currency: string | null;
  divisor: number;
} {
  if (!raw) return { currency: null, divisor: 1 };
  const minor = MINOR_UNITS[raw];
  if (minor) return minor;
  return { currency: raw.toUpperCase(), divisor: 1 };
}

// Cambi gia' scaricati: nell'archivio molti titoli condividono la coppia
const FX_TTL_MS = 60 * 60 * 1000;
const fxCache = new Map<string, { at: number; candles: OHLCV[] }>();

async function fxCandles(from: string, to: string): Promise<OHLCV[]> {
  const pair = `${from}${to}=X`;
  const hit = fxCache.get(pair);
  if (hit && Date.now() - hit.at < FX_TTL_MS) return hit.candles;
  let candles: OHLCV[] = [];
  try {
    candles = await yahooDownload(pair, '5y', '1d');
  } catch {
    candles = [];
  }
  fxCache.set(pair, { at: Date.now(), candles });
  return candles;
}

/** Chiusura piu' vicina a un momento, entro `maxDays` giorni */
function closeNear(candles: OHLCV[], isoDate: string, maxDays = 10): number | null {
  const target = new Date(isoDate).getTime() / 1000;
  let best: OHLCV | null = null;
  let bestDiff = Infinity;
  for (const c of candles) {
    const d = Math.abs(c.t - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = c;
    }
  }
  if (!best || bestDiff > maxDays * 86400) return null;
  return best.c;
}

// ----------------------------------------------------------------------------
// Dodici mesi mobili
// ----------------------------------------------------------------------------

/**
 * Somma degli ultimi quattro trimestri fino a `asOf`, solo se sono
 * davvero consecutivi e recenti. Con buchi nella serie la somma
 * mescolerebbe periodi diversi.
 */
function quarterlyTtm(series: SeriesPoint[], asOf: string): number | null {
  const upTo = series.filter((p) => p.date <= asOf);
  if (upTo.length < 4) return null;
  const last4 = upTo.slice(-4);
  const span = daysBetween(last4[0].date, last4[3].date);
  // Da fine primo a fine quarto trimestre passano circa nove mesi
  if (span < 240 || span > 300) return null;
  if (daysBetween(last4[3].date, asOf) > 100) return null;
  const sum = last4.reduce((s, p) => s + p.value, 0);
  return Number.isFinite(sum) ? sum : null;
}

/** Ultimo esercizio chiuso entro `asOf`, se non piu' vecchio di un anno */
function annualAt(series: SeriesPoint[], asOf: string): SeriesPoint | null {
  let found: SeriesPoint | null = null;
  for (const p of series) if (p.date <= asOf) found = p;
  if (!found || daysBetween(found.date, asOf) > 366) return null;
  return found;
}

function ttmAt(q: SeriesPoint[], a: SeriesPoint[], asOf: string): number | null {
  return quarterlyTtm(q, asOf) ?? annualAt(a, asOf)?.value ?? null;
}

/**
 * Valore attuale e di un anno prima, sulla stessa base: trimestri se ce
 * ne sono otto consecutivi, altrimenti gli ultimi due esercizi.
 */
function yearOverYear(
  q: SeriesPoint[],
  a: SeriesPoint[],
  lastDate: string
): { now: number | null; yearAgo: number | null } {
  const qNow = quarterlyTtm(q, lastDate);
  const qAgo = quarterlyTtm(q, isoMinusDays(lastDate, 365));
  if (qNow != null && qAgo != null) return { now: qNow, yearAgo: qAgo };
  if (a.length >= 2) {
    return { now: a[a.length - 1].value, yearAgo: a[a.length - 2].value };
  }
  return { now: qNow ?? (a.length > 0 ? a[a.length - 1].value : null), yearAgo: null };
}

function growthPct(now: number | null, ago: number | null): number | null {
  if (now == null || ago == null || ago <= 0) return null;
  return ((now - ago) / Math.abs(ago)) * 100;
}

// ----------------------------------------------------------------------------
// Calcolo
// ----------------------------------------------------------------------------

export type YahooValuationDebug = {
  priceCurrency: string | null;
  financialCurrency: string | null;
  fxPair: string | null;
  quarterlyEpsPoints: number;
  annualEpsPoints: number;
  peHistoryPoints: number;
  /** Fattore applicato se il multiplo non tornava con quello di Yahoo */
  scaleFactor: number | null;
  yahooTrailingPE: number | null;
};

export type YahooValuationResult =
  | { ok: true; f: Fundamentals; debug: YahooValuationDebug }
  | { ok: false; reason: string; debug?: Partial<YahooValuationDebug> };

export async function fetchFundamentalsYahoo(
  ticker: string,
  candles: OHLCV[]
): Promise<YahooValuationResult> {
  const [fin, profile] = await Promise.all([
    fetchYahooFinancials(ticker),
    fetchYahooProfile(ticker),
  ]);

  if (!fin) {
    return {
      ok: false,
      reason: 'Yahoo non ha dati di bilancio per questo titolo.',
    };
  }
  if (candles.length < 100) {
    return { ok: false, reason: 'Storico dei prezzi troppo corto per il confronto.' };
  }

  // Valuta del prezzo: dal profilo, altrimenti dal grafico
  let rawPriceCur = profile?.currency ?? null;
  if (!rawPriceCur) rawPriceCur = (await yahooQuote(ticker))?.currency ?? null;
  const { currency: priceCur, divisor } = normalizeCurrency(rawPriceCur);
  const finCur =
    fin.currency?.toUpperCase() ?? profile?.financialCurrency?.toUpperCase() ?? priceCur;

  // Cambio: 1 unita' di valuta del bilancio = rate unita' di valuta del prezzo
  let fx: OHLCV[] | null = null;
  let fxPair: string | null = null;
  if (finCur && priceCur && finCur !== priceCur) {
    fxPair = `${finCur}${priceCur}=X`;
    fx = await fxCandles(finCur, priceCur);
    if (fx.length === 0) {
      return {
        ok: false,
        reason: `Bilancio in ${finCur} e prezzo in ${priceCur}: cambio non disponibile.`,
        debug: { priceCurrency: priceCur, financialCurrency: finCur, fxPair },
      };
    }
  }
  const fxAt = (d: string): number | null => {
    if (!fx) return 1;
    return closeNear(fx, d, 10);
  };

  const q = fin.quarterlyEps;
  const a = fin.annualEps;
  const lastReportDate = [q[q.length - 1]?.date, a[a.length - 1]?.date]
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();
  if (!lastReportDate) {
    return { ok: false, reason: 'Dati di bilancio insufficienti per questo titolo.' };
  }
  // Un bilancio di oltre un anno e mezzo fa non descrive l'azienda di oggi
  if (daysBetween(lastReportDate, new Date().toISOString().slice(0, 10)) > 550) {
    return { ok: false, reason: `Ultimo bilancio disponibile troppo vecchio (${lastReportDate}).` };
  }

  // --- Serie storica del multiplo -------------------------------------
  // Una chiusura trimestrale alla volta, andando indietro finche' c'e'
  // un utile a cui riferirsi e un prezzo con cui confrontarlo
  const earliest = [q[0]?.date, a[0]?.date]
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const peHistory: number[] = [];
  for (let k = 0; k < 40; k++) {
    const d = monthEndMinus(lastReportDate, k * 3);
    if (earliest && d < earliest) break;
    const eps = ttmAt(q, a, d);
    if (eps == null || eps <= 0) continue;
    const rate = fxAt(d);
    const px = closeNear(candles, d, 10);
    if (rate == null || px == null) continue;
    const pe = px / divisor / (eps * rate);
    if (Number.isFinite(pe) && pe > 0 && pe < 300) peHistory.push(pe);
  }

  // --- Multiplo attuale -------------------------------------------------
  const lastCandle = candles[candles.length - 1];
  const priceNow = lastCandle.c / divisor;
  const epsNow = fin.trailingEps?.value ?? ttmAt(q, a, lastReportDate);
  const rateNow = fx ? fx[fx.length - 1].c : 1;
  let currentPe =
    epsNow != null && epsNow > 0 ? priceNow / (epsNow * rateNow) : null;

  // Controllo incrociato col multiplo che calcola Yahoo. Uno scarto
  // grande e costante indica un'unita' diversa fra prezzo e utile, tipico
  // delle quotazioni americane di societa' estere, dove un titolo vale
  // piu' azioni. Si corregge tutta la serie con lo stesso fattore: lo
  // sconto sulla storia, che e' un rapporto, non cambia.
  let scaleFactor: number | null = null;
  const yPe = profile?.trailingPE ?? null;
  if (currentPe != null && yPe != null && yPe > 0) {
    const k = yPe / currentPe;
    if (k > 1.5 || k < 0.67) {
      scaleFactor = k;
      currentPe *= k;
      for (let i = 0; i < peHistory.length; i++) peHistory[i] *= k;
    }
  }

  const sorted = [...peHistory].sort((x, y) => x - y);
  const medianPe =
    sorted.length >= 6
      ? sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : null;

  // --- Andamento dell'azienda ----------------------------------------
  const epsYoY = yearOverYear(q, a, lastReportDate);
  const revYoY = yearOverYear(fin.quarterlyRevenue, fin.annualRevenue, lastReportDate);
  const niYoY = yearOverYear(fin.quarterlyNetIncome, fin.annualNetIncome, lastReportDate);

  const margin = (ni: number | null, rev: number | null) =>
    ni != null && rev != null && rev > 0 ? (ni / rev) * 100 : null;
  const netMargin = margin(niYoY.now, revYoY.now);
  const netMarginYearAgo = margin(niYoY.yearAgo, revYoY.yearAgo);

  const revByDate = new Map(fin.quarterlyRevenue.map((p) => [p.date, p.value]));
  const reports: QuarterReport[] = q
    .slice(-8)
    .reverse()
    .map((p) => ({
      periodEnd: p.date,
      filedDate: null,
      eps: p.value,
      revenue: revByDate.get(p.date) ?? null,
      form: null,
    }));

  const f: Fundamentals = {
    ticker,
    reports,
    nextReportEstimate: null,
    cadenceDays: null,
    ttmEps: epsNow,
    ttmEpsYearAgo: epsYoY.yearAgo,
    ttmRevenue: revYoY.now,
    ttmRevenueYearAgo: revYoY.yearAgo,
    netMargin,
    netMarginYearAgo,
    epsGrowthPct: growthPct(epsYoY.now, epsYoY.yearAgo),
    revenueGrowthPct: growthPct(revYoY.now, revYoY.yearAgo),
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
    price: lastCandle.c,
    lastReportDate,
    quartersAvailable: q.length,
  };

  return {
    ok: true,
    f,
    debug: {
      priceCurrency: priceCur,
      financialCurrency: finCur,
      fxPair,
      quarterlyEpsPoints: q.length,
      annualEpsPoints: a.length,
      peHistoryPoints: peHistory.length,
      scaleFactor,
      yahooTrailingPE: yPe,
    },
  };
}

export type { YahooFinancials };
