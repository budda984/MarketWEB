/**
 * Radar giornaliero: incrocia i criteri costruiti nelle varie sezioni e
 * produce una lista ristretta di titoli da approfondire.
 *
 * COSA COMBINA E PERCHE'
 * I quattro elementi guardano cose diverse, ed e' questo che rende utile
 * incrociarli. Sommare indicatori che misurano la stessa cosa non
 * rafforza il segnale, lo conta piu' volte.
 *
 *   1. Trend settimanale (HMA50)  -> il titolo e' in un rialzo di fondo
 *   2. Struttura del trend (MA)   -> il rialzo e' ordinato, non un rimbalzo
 *   3. Sconto sul prezzo          -> non e' gia' corso via
 *   4. Heikin Ashi giornaliero    -> il momento sta girando ORA
 *
 * Il primo e' un filtro eliminatorio: senza rialzo settimanale non si
 * entra in classifica, a prescindere dal resto. Gli altri concorrono al
 * punteggio.
 *
 * LIMITE DA TENERE PRESENTE
 * Questo punteggio composito non e' stato verificato sui dati storici.
 * E' un modo per ordinare una lista di candidati, non una misura di
 * probabilita' di guadagno.
 */

import type { OHLCV } from './yahoo';
import { heikinAshi } from './indicators';
import { screenTicker, type ScreenerResult } from './screener';

// ============================================================================
// HEIKIN ASHI
// ============================================================================

export type HeikinAshiSignal = {
  /** L'ultima candela HA e' rialzista */
  bullish: boolean;
  /** Da quante barre dura la serie corrente (rialzista o ribassista) */
  streak: number;
  /** Barre trascorse dall'ultimo cambio di colore, null se non avvenuto */
  flipBarsAgo: number | null;
  /** Il cambio e' da ribassista a rialzista */
  flipToBullish: boolean;
  /** Corpo medio delle ultime 3 candele in percentuale, misura di slancio */
  bodyStrengthPct: number;
};

export function analyzeHeikinAshi(
  candles: OHLCV[],
  lookback = 30
): HeikinAshiSignal | null {
  if (candles.length < lookback + 5) return null;
  const ha = heikinAshi(candles.slice(-(lookback + 5)));
  if (ha.length < 5) return null;

  const isBull = (c: OHLCV) => c.c >= c.o;
  const n = ha.length - 1;
  const bullish = isBull(ha[n]);

  // Lunghezza della serie corrente
  let streak = 1;
  for (let i = n - 1; i >= 0; i--) {
    if (isBull(ha[i]) === bullish) streak++;
    else break;
  }

  // Il cambio di colore e' avvenuto all'inizio della serie corrente,
  // purche' la serie non copra tutta la finestra osservata
  const flipBarsAgo = streak <= n ? streak - 1 : null;

  // Slancio: corpo medio delle ultime tre candele rispetto al prezzo
  let bodySum = 0;
  for (let i = n; i > n - 3 && i >= 0; i--) {
    bodySum += Math.abs(ha[i].c - ha[i].o) / (ha[i].c || 1);
  }
  const bodyStrengthPct = (bodySum / 3) * 100;

  return {
    bullish,
    streak,
    flipBarsAgo,
    flipToBullish: bullish && flipBarsAgo != null,
    bodyStrengthPct,
  };
}

/**
 * Punteggio 0-100 sul tempismo d'ingresso secondo Heikin Ashi.
 *
 * Il massimo NON e' su una lunga serie rialzista: quella indica un
 * movimento gia' avviato. Il punto piu' interessante e' il cambio di
 * colore appena avvenuto, quando il movimento sta iniziando.
 */
export function heikinAshiScore(ha: HeikinAshiSignal): number {
  if (!ha.bullish) return 0;

  let base: number;
  if (ha.flipBarsAgo == null) base = 45; // rialzista da sempre nella finestra
  else if (ha.flipBarsAgo <= 1) base = 100; // appena girata
  else if (ha.flipBarsAgo <= 3) base = 85;
  else if (ha.flipBarsAgo <= 6) base = 65;
  else if (ha.flipBarsAgo <= 10) base = 45;
  else base = 30; // rialzo maturo

  // Corpi consistenti confermano lo slancio, ma pesano poco
  const bodyBonus = Math.min(ha.bodyStrengthPct * 4, 12);
  return Math.round(Math.min(100, base + bodyBonus));
}

// ============================================================================
// PUNTEGGIO COMPLESSIVO
// ============================================================================

export type OpportunityInput = {
  ticker: string;
  candles: OHLCV[];
  /** Stato settimanale letto dalla tabella weekly_trend_state */
  weeklyState: 'above' | 'below' | null;
  /** Data dell'ultimo cambio di stato settimanale, se recente */
  weeklyFlippedAt: string | null;
  /** Numero di insider distinti che hanno comprato di recente */
  insiderBuyers: number;
  market: string | null;
  sectorName: string | null;
  sectorRank: number | null;
  sectorPerf3m: number | null;
};

export type Opportunity = {
  ticker: string;
  market: string | null;
  sectorName: string | null;
  sectorRank: number | null;

  price: number;
  weeklyState: 'above' | 'below' | null;
  weeklyFlipRecent: boolean;

  trendScore: number;
  discountScore: number;
  haScore: number;
  insiderBuyers: number;

  totalScore: number;

  // Dettagli per la lettura
  rsi14: number | null;
  distFrom52wHigh: number;
  distFromMa50: number;
  perf3m: number | null;
  haFlipBarsAgo: number | null;
  haBullish: boolean;
  trendChecksPassed: number;

  /** Motivi in chiaro, per capire perche' e' in lista */
  reasons: string[];
};

type ScoreWeights = {
  trend: number;
  discount: number;
  ha: number;
};

const WEIGHTS: ScoreWeights = {
  trend: 0.35,
  discount: 0.35,
  ha: 0.30,
};

/**
 * Valuta un titolo. Ritorna null se non supera i filtri eliminatori
 * oppure se i dati non bastano.
 */
export function evaluateOpportunity(
  input: OpportunityInput,
  opts: { requireWeeklyAbove?: boolean; minTrendChecks?: number } = {}
): Opportunity | null {
  const requireWeeklyAbove = opts.requireWeeklyAbove !== false;
  const minTrendChecks = opts.minTrendChecks ?? 5;

  // FILTRO 1 — trend settimanale. E' il criterio su cui hai riscontro
  // diretto, quindi qui e' eliminatorio e non un semplice punto in piu'.
  if (requireWeeklyAbove && input.weeklyState !== 'above') return null;

  const screen: ScreenerResult | null = screenTicker(
    input.ticker,
    input.candles,
    {
      market: input.market,
      sectorName: input.sectorName,
      sectorRank: input.sectorRank,
      sectorPerf3m: input.sectorPerf3m,
    }
  );
  if (!screen) return null;

  const checksPassed = Object.values(screen.checks).filter(Boolean).length;
  // FILTRO 2 — struttura minima del trend
  if (checksPassed < minTrendChecks) return null;

  const ha = analyzeHeikinAshi(input.candles);
  if (!ha) return null;

  // FILTRO 3 — Heikin Ashi deve essere girata al rialzo: e' il fattore
  // di tempismo, senza il quale la lista sarebbe solo "titoli buoni"
  // senza indicazione di quando guardarli.
  if (!ha.bullish) return null;

  const haScore = heikinAshiScore(ha);

  const base =
    screen.trendScore * WEIGHTS.trend +
    screen.discountScore * WEIGHTS.discount +
    haScore * WEIGHTS.ha;

  // Elementi accessori: spostano poco, e volutamente. Sono conferme
  // indipendenti, non criteri portanti.
  let bonus = 0;
  const reasons: string[] = [];

  const weeklyFlipRecent = isRecentFlip(input.weeklyFlippedAt, 35);
  if (weeklyFlipRecent) {
    bonus += 6;
    reasons.push('Trend settimanale girato al rialzo da poco');
  } else {
    reasons.push('Trend settimanale sopra la HMA50');
  }

  if (input.insiderBuyers >= 2) {
    bonus += Math.min(6, input.insiderBuyers * 2);
    reasons.push(`${input.insiderBuyers} insider hanno comprato di recente`);
  }

  if (ha.flipBarsAgo != null && ha.flipBarsAgo <= 3) {
    reasons.push(
      `Heikin Ashi girata al rialzo ${ha.flipBarsAgo === 0 ? 'oggi' : `${ha.flipBarsAgo} sedute fa`}`
    );
  }

  if (screen.discountScore >= 65) {
    reasons.push(
      `Ritracciato del ${screen.distFrom52wHigh.toFixed(0)}% dal massimo di periodo`
    );
  }

  if (screen.rsi14 != null && screen.rsi14 <= 50) {
    reasons.push(`RSI a ${screen.rsi14.toFixed(0)}, non ipercomprato`);
  }

  if (input.sectorRank != null && input.sectorRank <= 3) {
    bonus += 3;
    reasons.push(`Settore ${input.sectorName} tra i primi ${input.sectorRank}`);
  }

  const totalScore = Math.round(Math.min(100, base + bonus));

  return {
    ticker: input.ticker,
    market: input.market,
    sectorName: input.sectorName,
    sectorRank: input.sectorRank,
    price: screen.price,
    weeklyState: input.weeklyState,
    weeklyFlipRecent,
    trendScore: screen.trendScore,
    discountScore: screen.discountScore,
    haScore,
    insiderBuyers: input.insiderBuyers,
    totalScore,
    rsi14: screen.rsi14,
    distFrom52wHigh: screen.distFrom52wHigh,
    distFromMa50: screen.distFromMa50,
    perf3m: screen.perf3m,
    haFlipBarsAgo: ha.flipBarsAgo,
    haBullish: ha.bullish,
    trendChecksPassed: checksPassed,
    reasons,
  };
}

function isRecentFlip(dateStr: string | null, maxDays: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (!Number.isFinite(d)) return false;
  return (Date.now() - d) / 86400000 <= maxDays;
}

/** Riga per la notifica Telegram. */
export function formatOpportunityLine(o: Opportunity): string {
  return (
    `<b>${o.ticker}</b> ${o.price.toFixed(2)} · punteggio ${o.totalScore}\n` +
    `   trend ${o.trendScore} · sconto ${o.discountScore} · HA ${o.haScore}` +
    (o.insiderBuyers >= 2 ? ` · ${o.insiderBuyers} insider` : '')
  );
}
