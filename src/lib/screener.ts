/**
 * Screener: individua titoli in trend forte, dentro settori forti,
 * temporaneamente in pullback (ipervenduto RELATIVO, non assoluto).
 *
 * Tutto calcolato da OHLCV — nessuna API di fondamentali richiesta.
 *
 * Logica in 3 livelli:
 *   1. Forza settoriale: ranking degli ETF settoriali vs SPY
 *   2. Trend template: struttura del trend del singolo titolo (Minervini)
 *   3. Pullback: RSI e distanza dalle medie per il timing di ingresso
 *
 * NOTA METODOLOGICA: "ipervenduto" ha significati opposti a seconda del
 * contesto. RSI basso in downtrend = titolo che sta crollando (trappola).
 * RSI basso in uptrend confermato = pausa in una salita (occasione).
 * Questo screener cerca SOLO il secondo caso: il filtro trend viene
 * PRIMA del filtro RSI, mai il contrario.
 */

import type { OHLCV } from './yahoo';

// ============================================================================
// ETF SETTORIALI (SPDR Select Sector) — benchmark per la rotazione
// ============================================================================

export const SECTOR_ETFS: Record<string, string> = {
  XLK: 'Tecnologia',
  XLF: 'Finanza',
  XLV: 'Sanità',
  XLE: 'Energia',
  XLI: 'Industriali',
  XLY: 'Consumi discrezionali',
  XLP: 'Consumi difensivi',
  XLU: 'Utilities',
  XLB: 'Materiali',
  XLRE: 'Immobiliare',
  XLC: 'Comunicazioni',
};

export const BENCHMARK = 'SPY';

/**
 * Mappa ticker → ETF settoriale di riferimento.
 * Copre i principali titoli USA. I ticker non mappati vengono comunque
 * analizzati ma senza punteggio di forza relativa settoriale.
 */
export const TICKER_SECTOR: Record<string, string> = {
  // Tecnologia
  AAPL: 'XLK', MSFT: 'XLK', NVDA: 'XLK', AVGO: 'XLK', ORCL: 'XLK',
  CRM: 'XLK', AMD: 'XLK', ADBE: 'XLK', ACN: 'XLK', CSCO: 'XLK',
  INTC: 'XLK', QCOM: 'XLK', TXN: 'XLK', IBM: 'XLK', NOW: 'XLK',
  INTU: 'XLK', AMAT: 'XLK', MU: 'XLK', LRCX: 'XLK', KLAC: 'XLK',
  ADI: 'XLK', SNPS: 'XLK', CDNS: 'XLK', MRVL: 'XLK', PANW: 'XLK',
  FTNT: 'XLK', CRWD: 'XLK', ANET: 'XLK', NXPI: 'XLK', MCHP: 'XLK',
  ON: 'XLK', SMCI: 'XLK', ARM: 'XLK', PLTR: 'XLK', DDOG: 'XLK',
  NET: 'XLK', SNOW: 'XLK', ZS: 'XLK', OKTA: 'XLK', MDB: 'XLK',
  TEAM: 'XLK', WDAY: 'XLK', HUBS: 'XLK', CDW: 'XLK', ASML: 'XLK',

  // Finanza
  'BRK-B': 'XLF', JPM: 'XLF', V: 'XLF', MA: 'XLF', BAC: 'XLF',
  WFC: 'XLF', GS: 'XLF', MS: 'XLF', C: 'XLF', AXP: 'XLF',
  BLK: 'XLF', SCHW: 'XLF', USB: 'XLF', PNC: 'XLF', TFC: 'XLF',
  COF: 'XLF', BK: 'XLF', MET: 'XLF', AIG: 'XLF', PRU: 'XLF',
  ALL: 'XLF', TRV: 'XLF', AFL: 'XLF', CB: 'XLF', PGR: 'XLF',
  HIG: 'XLF', CME: 'XLF', ICE: 'XLF', SPGI: 'XLF', MCO: 'XLF',
  MSCI: 'XLF', NDAQ: 'XLF', COIN: 'XLF', HOOD: 'XLF', SOFI: 'XLF',
  AFRM: 'XLF', UPST: 'XLF', PYPL: 'XLF',

  // Sanità
  JNJ: 'XLV', UNH: 'XLV', LLY: 'XLV', ABBV: 'XLV', MRK: 'XLV',
  PFE: 'XLV', TMO: 'XLV', ABT: 'XLV', DHR: 'XLV', BMY: 'XLV',
  AMGN: 'XLV', MDT: 'XLV', ELV: 'XLV', GILD: 'XLV', ISRG: 'XLV',
  CVS: 'XLV', HUM: 'XLV', CI: 'XLV', VRTX: 'XLV', REGN: 'XLV',
  BSX: 'XLV', SYK: 'XLV', ZTS: 'XLV', BDX: 'XLV', EW: 'XLV',
  HCA: 'XLV', BIIB: 'XLV', ILMN: 'XLV', DXCM: 'XLV', ALGN: 'XLV',

  // Energia
  XOM: 'XLE', CVX: 'XLE', COP: 'XLE', EOG: 'XLE', MPC: 'XLE',
  PSX: 'XLE', VLO: 'XLE', OXY: 'XLE', SLB: 'XLE', HAL: 'XLE',

  // Industriali
  BA: 'XLI', CAT: 'XLI', HON: 'XLI', UPS: 'XLI', RTX: 'XLI',
  LMT: 'XLI', GE: 'XLI', MMM: 'XLI', DE: 'XLI', EMR: 'XLI',
  ITW: 'XLI', ETN: 'XLI', CMI: 'XLI', FDX: 'XLI', NOC: 'XLI',
  GD: 'XLI', CSX: 'XLI', UNP: 'XLI', NSC: 'XLI', LUV: 'XLI',
  DAL: 'XLI', UAL: 'XLI', VRSK: 'XLI',

  // Consumi discrezionali
  AMZN: 'XLY', TSLA: 'XLY', HD: 'XLY', MCD: 'XLY', NKE: 'XLY',
  LOW: 'XLY', SBUX: 'XLY', TJX: 'XLY', BKNG: 'XLY', ABNB: 'XLY',
  MAR: 'XLY', HLT: 'XLY', MGM: 'XLY', CCL: 'XLY', RCL: 'XLY',
  YUM: 'XLY', CMG: 'XLY', DPZ: 'XLY', ULTA: 'XLY', BBY: 'XLY',
  ROST: 'XLY', LULU: 'XLY', DECK: 'XLY', RL: 'XLY', TPR: 'XLY',
  HAS: 'XLY', MAT: 'XLY', RIVN: 'XLY', LCID: 'XLY', CHWY: 'XLY',
  ETSY: 'XLY', EBAY: 'XLY', DASH: 'XLY', MELI: 'XLY', DKNG: 'XLY',
  PENN: 'XLY', DLTR: 'XLY', TGT: 'XLY',

  // Consumi difensivi
  WMT: 'XLP', PG: 'XLP', COST: 'XLP', KO: 'XLP', PEP: 'XLP',
  CL: 'XLP', MDLZ: 'XLP', MO: 'XLP', PM: 'XLP', EL: 'XLP',
  KMB: 'XLP', GIS: 'XLP', K: 'XLP', HSY: 'XLP', CLX: 'XLP',
  CHD: 'XLP', MKC: 'XLP', STZ: 'XLP', KHC: 'XLP', TSN: 'XLP',
  KR: 'XLP', KDP: 'XLP',

  // Utilities
  NEE: 'XLU', DUK: 'XLU', SO: 'XLU', D: 'XLU', AEP: 'XLU',

  // Materiali
  LIN: 'XLB', SHW: 'XLB', NEM: 'XLB', FCX: 'XLB',

  // Immobiliare
  PLD: 'XLRE', AMT: 'XLRE', EQIX: 'XLRE', CCI: 'XLRE',
  SPG: 'XLRE', O: 'XLRE',

  // Comunicazioni
  GOOGL: 'XLC', GOOG: 'XLC', META: 'XLC', NFLX: 'XLC', DIS: 'XLC',
  CMCSA: 'XLC', T: 'XLC', VZ: 'XLC', TMUS: 'XLC', CHTR: 'XLC',
  EA: 'XLC', TTWO: 'XLC', SPOT: 'XLC', RBLX: 'XLC', PINS: 'XLC',
  SNAP: 'XLC', TTD: 'XLC', UBER: 'XLC', SIRI: 'XLC', ROKU: 'XLC',
};

// ============================================================================
// INDICATORI
// ============================================================================

/** Media mobile semplice. Ritorna null dove non ci sono dati sufficienti. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * RSI di Wilder a `period` barre (default 14).
 * Ritorna valori 0-100, null dove non calcolabile.
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Performance percentuale sulle ultime `bars` barre. */
export function perfOverBars(candles: OHLCV[], bars: number): number | null {
  if (candles.length < bars + 1) return null;
  const end = candles[candles.length - 1].c;
  const start = candles[candles.length - 1 - bars].c;
  if (!start) return null;
  return ((end - start) / start) * 100;
}

// ============================================================================
// FORZA SETTORIALE
// ============================================================================

export type SectorStrength = {
  etf: string;
  name: string;
  perf1m: number | null;
  perf3m: number | null;
  perf6m: number | null;
  /** Sovraperformance vs SPY su 3 mesi, in punti percentuali */
  rsVsBenchmark: number | null;
  /** Punteggio 0-100 composito su 1m/3m/6m */
  score: number;
  rank: number;
};

/**
 * Classifica i settori per forza relativa.
 * Pesi: 3 mesi conta di più (il "core" della rotazione), 1 mese cattura
 * l'accelerazione recente, 6 mesi conferma che non sia un rimbalzo.
 */
export function rankSectors(
  candlesByTicker: Record<string, OHLCV[]>
): SectorStrength[] {
  const benchCandles = candlesByTicker[BENCHMARK];
  const bench3m = benchCandles ? perfOverBars(benchCandles, 63) : null;

  const rows: Omit<SectorStrength, 'rank'>[] = [];

  for (const [etf, name] of Object.entries(SECTOR_ETFS)) {
    const candles = candlesByTicker[etf];
    if (!candles || candles.length < 30) continue;

    const perf1m = perfOverBars(candles, 21);
    const perf3m = perfOverBars(candles, 63);
    const perf6m = perfOverBars(candles, 126);

    const rsVsBenchmark =
      perf3m != null && bench3m != null ? perf3m - bench3m : null;

    // Score composito: normalizzo ogni performance su una scala ragionevole
    // (±30% = estremi) e peso 1m 30%, 3m 45%, 6m 25%
    const n1 = perf1m != null ? clamp01((perf1m + 15) / 30) : 0.5;
    const n3 = perf3m != null ? clamp01((perf3m + 25) / 50) : 0.5;
    const n6 = perf6m != null ? clamp01((perf6m + 35) / 70) : 0.5;
    const score = Math.round((n1 * 0.3 + n3 * 0.45 + n6 * 0.25) * 100);

    rows.push({ etf, name, perf1m, perf3m, perf6m, rsVsBenchmark, score });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ============================================================================
// TREND TEMPLATE + PULLBACK
// ============================================================================

export type TrendChecks = {
  priceAboveMa150: boolean;
  priceAboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma50AboveMa150: boolean;
  ma200Rising: boolean;
  priceAbove52wLow: boolean; // ≥ 30% sopra il minimo
  priceNear52wHigh: boolean; // entro il 25% dal massimo
  priceAboveMa50: boolean;
};

export type ScreenerResult = {
  ticker: string;
  market: string | null;
  sectorEtf: string | null;
  sectorName: string | null;
  sectorRank: number | null;

  price: number;
  ma20: number | null;
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;

  perf1m: number | null;
  perf3m: number | null;
  perf6m: number | null;
  /** Sovraperformance vs il proprio ETF settoriale su 3 mesi */
  rsVsSector: number | null;

  rsi14: number | null;
  distFrom52wHigh: number; // % sotto il massimo (positivo)
  distFrom52wLow: number; // % sopra il minimo (positivo)
  distFromMa50: number; // % di scostamento dalla MA50 (può essere negativo)

  checks: TrendChecks;
  trendScore: number; // 0-100, quanti check passati
  momentumScore: number; // 0-100, forza relativa
  pullbackScore: number; // 0-100, quanto è buono il timing d'ingresso
  /**
   * 0-100. Quanto il titolo è "a sconto" RISPETTO AL PROPRIO TREND:
   * distanza dal massimo 52w, posizione vs MA50/MA200, compressione RSI.
   * NON è sottovalutazione fondamentale (servirebbero utili, P/E, debito).
   */
  discountScore: number;
  totalScore: number; // 0-100 composito
  /** Composito che privilegia lo sconto: trend forte + prezzo ritracciato */
  valueInTrendScore: number;

  /** true se passa il trend template completo (tutti i check strutturali) */
  trendTemplatePass: boolean;
  /** true se è in pullback utile dentro un trend valido */
  inPullback: boolean;
};

type ScreenerOpts = {
  /** Numero minimo di check del trend template da superare (default 6 su 8) */
  minChecks?: number;
  /** RSI: finestra considerata "pullback utile" in uptrend */
  pullbackRsiMin?: number;
  pullbackRsiMax?: number;
  /** Scostamento massimo dalla MA50 per considerare il pullback "controllato" */
  maxDistFromMa50?: number;
};

const DEFAULT_SCREENER_OPTS: Required<ScreenerOpts> = {
  minChecks: 6,
  pullbackRsiMin: 32,
  pullbackRsiMax: 50,
  maxDistFromMa50: 12,
};

/**
 * Analizza un singolo titolo. Ritorna null se i dati sono insufficienti
 * (servono almeno 200 candele per la MA200).
 */
export function screenTicker(
  ticker: string,
  candles: OHLCV[],
  opts: {
    market?: string | null;
    sectorPerf3m?: number | null;
    sectorEtf?: string | null;
    sectorName?: string | null;
    sectorRank?: number | null;
    config?: ScreenerOpts;
  } = {}
): ScreenerResult | null {
  const o = { ...DEFAULT_SCREENER_OPTS, ...(opts.config ?? {}) };
  if (candles.length < 200) return null;

  const closes = candles.map((c) => c.c);
  const last = closes.length - 1;
  const price = closes[last];
  if (!price || !Number.isFinite(price)) return null;

  const ma20Arr = sma(closes, 20);
  const ma50Arr = sma(closes, 50);
  const ma150Arr = sma(closes, 150);
  const ma200Arr = sma(closes, 200);
  const rsiArr = rsi(closes, 14);

  const ma20 = ma20Arr[last];
  const ma50 = ma50Arr[last];
  const ma150 = ma150Arr[last];
  const ma200 = ma200Arr[last];
  const rsi14 = rsiArr[last];

  if (ma200 == null || ma150 == null || ma50 == null) return null;

  // MA200 in salita: confronto con 21 barre fa (circa un mese)
  const ma200Prev = ma200Arr[Math.max(0, last - 21)];
  const ma200Rising = ma200Prev != null && ma200 > ma200Prev;

  // 52 settimane = ~252 barre giornaliere
  const window = candles.slice(Math.max(0, candles.length - 252));
  const high52 = Math.max(...window.map((c) => c.h));
  const low52 = Math.min(...window.map((c) => c.l));
  const distFrom52wHigh = ((high52 - price) / high52) * 100;
  const distFrom52wLow = ((price - low52) / low52) * 100;
  const distFromMa50 = ((price - ma50) / ma50) * 100;

  const checks: TrendChecks = {
    priceAboveMa150: price > ma150,
    priceAboveMa200: price > ma200,
    ma150AboveMa200: ma150 > ma200,
    ma50AboveMa150: ma50 > ma150,
    ma200Rising,
    priceAbove52wLow: distFrom52wLow >= 30,
    priceNear52wHigh: distFrom52wHigh <= 25,
    priceAboveMa50: price > ma50,
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const trendScore = Math.round((passedChecks / 8) * 100);
  const trendTemplatePass = passedChecks >= o.minChecks;

  const perf1m = perfOverBars(candles, 21);
  const perf3m = perfOverBars(candles, 63);
  const perf6m = perfOverBars(candles, 126);

  const rsVsSector =
    perf3m != null && opts.sectorPerf3m != null
      ? perf3m - opts.sectorPerf3m
      : null;

  // Momentum score: performance assoluta + sovraperformance sul settore
  const nAbs = perf3m != null ? clamp01((perf3m + 20) / 60) : 0.5;
  const nRel = rsVsSector != null ? clamp01((rsVsSector + 15) / 40) : 0.5;
  const momentumScore = Math.round((nAbs * 0.55 + nRel * 0.45) * 100);

  // Pullback score: premia RSI nella fascia utile E prezzo vicino alla MA50
  // senza averla rotta al ribasso in modo netto.
  let pullbackScore = 0;
  let inPullback = false;
  if (rsi14 != null && trendTemplatePass) {
    const inRsiBand = rsi14 >= o.pullbackRsiMin && rsi14 <= o.pullbackRsiMax;
    const nearMa50 = Math.abs(distFromMa50) <= o.maxDistFromMa50;
    if (inRsiBand) {
      // Il centro ideale della banda RSI vale di più
      const center = (o.pullbackRsiMin + o.pullbackRsiMax) / 2;
      const halfWidth = (o.pullbackRsiMax - o.pullbackRsiMin) / 2;
      const rsiQuality = 1 - Math.abs(rsi14 - center) / halfWidth;
      const maQuality = nearMa50
        ? 1 - Math.abs(distFromMa50) / o.maxDistFromMa50
        : 0;
      pullbackScore = Math.round((rsiQuality * 0.6 + maQuality * 0.4) * 100);
      inPullback = nearMa50;
    }
  }

  // ------------------------------------------------------------------
  // DISCOUNT SCORE — quanto il titolo è "a sconto" rispetto a sé stesso
  // ------------------------------------------------------------------
  // Tre componenti, tutte relative alla storia del titolo:
  //   a) distanza dal massimo 52 settimane (più è sotto, più è scontato)
  //   b) posizione rispetto alla MA50 (sotto = sconto, molto sotto = allarme)
  //   c) compressione RSI (più è basso, più è ipervenduto)
  //
  // Il massimo del punteggio NON è al ribasso estremo: un titolo a -60%
  // dal massimo non è "in saldo", è un titolo che sta crollando. La
  // curva premia lo sconto moderato (10-25% dal massimo).
  const discountFromHigh = (() => {
    const d = distFrom52wHigh;
    if (d < 3) return 0.1; // sui massimi: nessuno sconto
    if (d <= 25) return 1 - Math.abs(d - 15) / 15; // ottimo tra 8% e 22%
    if (d <= 40) return 0.3; // sconto ampio, più rischioso
    return 0.05; // troppo lontano dai massimi
  })();

  const discountFromMa = (() => {
    const d = distFromMa50;
    if (d > 15) return 0.05; // molto esteso sopra la media
    if (d > 5) return 0.3;
    if (d >= -8) return 1 - Math.abs(d - -1) / 9; // ideale attorno alla MA50
    if (d >= -18) return 0.35;
    return 0.05; // molto sotto: trend probabilmente rotto
  })();

  const discountFromRsi = (() => {
    if (rsi14 == null) return 0.4;
    if (rsi14 > 70) return 0.05; // ipercomprato
    if (rsi14 > 55) return 0.3;
    if (rsi14 >= 35) return 1 - Math.abs(rsi14 - 43) / 20; // fascia ideale
    if (rsi14 >= 25) return 0.4;
    return 0.15; // sotto 25 in un uptrend è anomalo
  })();

  const discountScore = Math.round(
    clamp01(
      discountFromHigh * 0.4 + discountFromMa * 0.35 + discountFromRsi * 0.25
    ) * 100
  );

  // Score totale: il trend pesa di più perché è il filtro di sopravvivenza,
  // il pullback è solo timing.
  const totalScore = Math.round(
    trendScore * 0.4 + momentumScore * 0.35 + pullbackScore * 0.25
  );

  // "Valore dentro il trend": privilegia titoli strutturalmente solidi che
  // però adesso sono ritracciati. Il trend resta un requisito (peso 45%),
  // ma lo sconto pesa più del momentum — cerchiamo chi è sceso, non chi
  // sta correndo.
  const valueInTrendScore = Math.round(
    trendScore * 0.45 + discountScore * 0.4 + momentumScore * 0.15
  );

  return {
    ticker,
    market: opts.market ?? null,
    sectorEtf: opts.sectorEtf ?? null,
    sectorName: opts.sectorName ?? null,
    sectorRank: opts.sectorRank ?? null,
    price,
    ma20,
    ma50,
    ma150,
    ma200,
    perf1m,
    perf3m,
    perf6m,
    rsVsSector,
    rsi14,
    distFrom52wHigh,
    distFrom52wLow,
    distFromMa50,
    checks,
    trendScore,
    momentumScore,
    pullbackScore,
    discountScore,
    totalScore,
    valueInTrendScore,
    trendTemplatePass,
    inPullback,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
