/**
 * Motore del Replay: logica pura, senza React ne' rete.
 *
 * Convenzione sui tempi: tutti i timestamp qui dentro sono gia' spostati
 * sull'ora della borsa (t + gmtoffset). Cosi' il grafico mostra l'orario
 * di borsa e il raggruppamento per giorno/settimana cade giusto.
 *
 * Il "cursore" e' l'indice dell'ultima candela base visibile: tutto cio'
 * che sta dopo non esiste per il grafico, quindi niente sbirciate.
 */

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Risoluzione dei dati scaricati */
export type BaseTf = '1m' | '5m' | '1h' | '1d';

/** Timeframe mostrato sul grafico, ricostruito dalla base */
export type DisplayTf = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M';

export const BASE_OPTIONS: { key: BaseTf; label: string; depth: string }[] = [
  { key: '1m', label: '1 minuto', depth: 'ultimi 30 giorni' },
  { key: '5m', label: '5 minuti', depth: 'ultimi 60 giorni' },
  { key: '1h', label: '1 ora', depth: 'ultimi 2 anni' },
  { key: '1d', label: 'Giornaliero', depth: 'circa 10 anni' },
];

/** Timeframe disponibili per ciascuna base (solo multipli della base) */
export const DISPLAY_FOR_BASE: Record<BaseTf, DisplayTf[]> = {
  '1m': ['1m', '5m', '15m', '30m', '1h', '4h', '1D'],
  '5m': ['5m', '15m', '30m', '1h', '4h', '1D'],
  '1h': ['1h', '4h', '1D', '1W'],
  '1d': ['1D', '1W', '1M'],
};

/** Durata indicativa in secondi: serve a proiettare i disegni nel futuro */
export const TF_SECONDS: Record<DisplayTf, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
  '1M': 2592000,
};

export function isIntraday(tf: DisplayTf): boolean {
  return TF_SECONDS[tf] < 86400;
}

// ============================================================================
// Aggregazione per timeframe
// ============================================================================

export type Buckets = {
  tf: DisplayTf;
  /** Indice base di inizio di ogni candela aggregata */
  start: number[];
  /** Indice base di fine (incluso) di ogni candela aggregata */
  end: number[];
  /** Per ogni candela base, a quale candela aggregata appartiene */
  of: Int32Array;
  /** Candele aggregate complete, calcolate una volta sola */
  full: Bar[];
};

function dayOf(t: number): number {
  return Math.floor(t / 86400);
}

/**
 * Raggruppa le candele base nel timeframe richiesto.
 * Gli intraday partono dalla prima candela della giornata (per le azioni
 * USA l'1h e' allineata alle 9:30, come su TradingView).
 */
export function buildBuckets(bars: Bar[], tf: DisplayTf): Buckets {
  const start: number[] = [];
  const end: number[] = [];
  const of = new Int32Array(bars.length);
  const sec = TF_SECONDS[tf];

  let prevKey: string | null = null;
  let dayFirstT = 0;
  let prevDay = -1;

  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].t;
    const day = dayOf(t);
    if (day !== prevDay) {
      dayFirstT = t;
      prevDay = day;
    }
    let key: string;
    if (isIntraday(tf)) {
      key = `${day}:${Math.floor((t - dayFirstT) / sec)}`;
    } else if (tf === '1D') {
      key = `${day}`;
    } else if (tf === '1W') {
      // Il 1/1/1970 era giovedi': +3 fa iniziare la settimana di lunedi'
      key = `${Math.floor((day + 3) / 7)}`;
    } else {
      const d = new Date(t * 1000);
      key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    }
    if (key !== prevKey) {
      if (start.length > 0) end.push(i - 1);
      start.push(i);
      prevKey = key;
    }
    of[i] = start.length - 1;
  }
  if (start.length > 0) end.push(bars.length - 1);

  const full: Bar[] = start.map((s, k) => aggregate(bars, s, end[k]));
  return { tf, start, end, of, full };
}

export function aggregate(bars: Bar[], from: number, to: number): Bar {
  let h = -Infinity;
  let l = Infinity;
  let v = 0;
  for (let i = from; i <= to; i++) {
    if (bars[i].h > h) h = bars[i].h;
    if (bars[i].l < l) l = bars[i].l;
    v += bars[i].v;
  }
  return { t: bars[from].t, o: bars[from].o, h, l, c: bars[to].c, v };
}

/** Candele visibili al cursore: le complete + quella in formazione */
export function visibleBars(bars: Bar[], b: Buckets, cursor: number): Bar[] {
  if (bars.length === 0) return [];
  const k = b.of[cursor];
  const out = b.full.slice(0, k);
  out.push(aggregate(bars, b.start[k], cursor));
  return out;
}

/**
 * Passo di una candela: se quella corrente e' incompleta la completa,
 * altrimenti mostra per intero la successiva.
 */
export function nextStepCursor(b: Buckets, cursor: number, total: number): number {
  const k = b.of[cursor];
  if (cursor < b.end[k]) return b.end[k];
  if (k + 1 < b.end.length) return b.end[k + 1];
  return total - 1;
}

/** Media di candele base per candela aggregata: regola la velocita' del play */
export function basePerDisplay(b: Buckets, total: number): number {
  return b.start.length > 0 ? total / b.start.length : 1;
}

/** ATR semplice sulle ultime n candele visibili, per proporre stop e target */
export function atr(bars: Bar[], n = 14): number {
  if (bars.length < 2) return 0;
  const from = Math.max(1, bars.length - n);
  let sum = 0;
  let count = 0;
  for (let i = from; i < bars.length; i++) {
    const p = bars[i - 1].c;
    const b = bars[i];
    sum += Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p));
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ============================================================================
// Ordini e posizioni
// ============================================================================

export type Side = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type ExitReason = 'TARGET' | 'STOP' | 'MANUALE' | 'FINE_DATI';

export type Trade = {
  id: string;
  side: Side;
  orderType: OrderType;
  status: 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  /** Prezzo richiesto (per MARKET e' la chiusura al momento dell'ordine) */
  plannedEntry: number;
  stop: number;
  target: number;
  tf: DisplayTf;
  placedT: number;
  placedIdx: number;
  fillPrice?: number;
  fillT?: number;
  fillIdx?: number;
  exitPrice?: number;
  exitT?: number;
  exitIdx?: number;
  exitReason?: ExitReason;
  /** Escursioni massime in prezzo dall'entrata (favorevole / avversa) */
  maxFav: number;
  maxAdv: number;
};

/** Controlla che stop e target stiano dalla parte giusta dell'entrata */
export function validateOrder(
  side: Side,
  orderType: OrderType,
  entry: number,
  stop: number,
  target: number,
  lastClose: number
): string | null {
  if (![entry, stop, target].every((x) => Number.isFinite(x) && x > 0)) {
    return 'Inserisci prezzi validi';
  }
  if (side === 'LONG' && !(stop < entry && entry < target)) {
    return 'Nel long lo stop va sotto l’entrata e il target sopra';
  }
  if (side === 'SHORT' && !(target < entry && entry < stop)) {
    return 'Nello short lo stop va sopra l’entrata e il target sotto';
  }
  if (orderType === 'LIMIT') {
    if (side === 'LONG' && entry >= lastClose) return 'Il limit long va sotto il prezzo attuale';
    if (side === 'SHORT' && entry <= lastClose) return 'Il limit short va sopra il prezzo attuale';
  }
  if (orderType === 'STOP') {
    if (side === 'LONG' && entry <= lastClose) return 'Lo stop long va sopra il prezzo attuale';
    if (side === 'SHORT' && entry >= lastClose) return 'Lo stop short va sotto il prezzo attuale';
  }
  return null;
}

export function newTrade(
  side: Side,
  orderType: OrderType,
  entry: number,
  stop: number,
  target: number,
  tf: DisplayTf,
  cursorBar: Bar,
  cursor: number
): Trade {
  const base: Trade = {
    id: Math.random().toString(36).slice(2, 10),
    side,
    orderType,
    status: 'PENDING',
    plannedEntry: orderType === 'MARKET' ? cursorBar.c : entry,
    stop,
    target,
    tf,
    placedT: cursorBar.t,
    placedIdx: cursor,
    maxFav: 0,
    maxAdv: 0,
  };
  if (orderType === 'MARKET') {
    // A mercato: eseguito alla chiusura della candela corrente
    base.status = 'OPEN';
    base.fillPrice = cursorBar.c;
    base.fillT = cursorBar.t;
    base.fillIdx = cursor;
  }
  return base;
}

function closeTrade(tr: Trade, price: number, bar: Bar, idx: number, reason: ExitReason): Trade {
  return { ...tr, status: 'CLOSED', exitPrice: price, exitT: bar.t, exitIdx: idx, exitReason: reason };
}

/**
 * Applica una nuova candela base a un trade.
 * Regole prudenziali quando l'ordine interno alla candela non e' noto:
 * - se nella stessa candela vengono toccati stop e target, vince lo stop;
 * - nella candela in cui un ordine pendente viene eseguito, il target conta
 *   solo se la chiusura e' oltre il target;
 * - se l'apertura salta oltre stop o target (gap), si esce all'apertura.
 */
export function applyBar(tr: Trade, bar: Bar, idx: number): Trade {
  if (tr.status === 'CLOSED' || tr.status === 'CANCELLED') return tr;
  const long = tr.side === 'LONG';
  let t = tr;
  let fillBar = false;

  if (t.status === 'PENDING') {
    const e = t.plannedEntry;
    let fill: number | null = null;
    if (t.orderType === 'LIMIT') {
      if (long && bar.l <= e) fill = Math.min(e, bar.o);
      if (!long && bar.h >= e) fill = Math.max(e, bar.o);
    } else if (t.orderType === 'STOP') {
      if (long && bar.h >= e) fill = Math.max(e, bar.o);
      if (!long && bar.l <= e) fill = Math.min(e, bar.o);
    }
    if (fill == null) return t;
    t = { ...t, status: 'OPEN', fillPrice: fill, fillT: bar.t, fillIdx: idx };
    fillBar = true;
  }

  const entry = t.fillPrice as number;
  const hitStop = long ? bar.l <= t.stop : bar.h >= t.stop;
  const hitTarget = long ? bar.h >= t.target : bar.l <= t.target;

  if (!fillBar) {
    // Gap in apertura oltre i livelli: si esce al prezzo di apertura
    const gapStop = long ? bar.o <= t.stop : bar.o >= t.stop;
    const gapTarget = long ? bar.o >= t.target : bar.o <= t.target;
    if (gapStop) return withExcursion(closeTrade(t, bar.o, bar, idx, 'STOP'), entry);
    if (gapTarget) return withExcursion(closeTrade(t, bar.o, bar, idx, 'TARGET'), entry);
  }

  if (hitStop) {
    return withExcursion(closeTrade(t, t.stop, bar, idx, 'STOP'), entry);
  }
  const targetOk = fillBar ? (long ? bar.c >= t.target : bar.c <= t.target) : hitTarget;
  if (targetOk) {
    return withExcursion(closeTrade(t, t.target, bar, idx, 'TARGET'), entry);
  }

  // Ancora aperto: aggiorno le escursioni massime
  const fav = long ? bar.h - entry : entry - bar.l;
  const adv = long ? entry - bar.l : bar.h - entry;
  return { ...t, maxFav: Math.max(t.maxFav, fav), maxAdv: Math.max(t.maxAdv, adv) };
}

/** Sulla candela di uscita conta solo il lato che ha chiuso il trade */
function withExcursion(t: Trade, entry: number): Trade {
  const move = t.side === 'LONG' ? (t.exitPrice as number) - entry : entry - (t.exitPrice as number);
  if (move >= 0) return { ...t, maxFav: Math.max(t.maxFav, move) };
  return { ...t, maxAdv: Math.max(t.maxAdv, -move) };
}

/** Chiusura manuale alla chiusura della candela corrente */
export function closeManual(tr: Trade, bar: Bar, idx: number, reason: ExitReason = 'MANUALE'): Trade {
  if (tr.status === 'PENDING') return { ...tr, status: 'CANCELLED' };
  if (tr.status !== 'OPEN') return tr;
  return withExcursion(closeTrade(tr, bar.c, bar, idx, reason), tr.fillPrice as number);
}

/** Rischio in prezzo: distanza tra entrata effettiva e stop */
export function riskOf(t: Trade): number {
  const e = t.fillPrice ?? t.plannedEntry;
  return Math.abs(e - t.stop);
}

/** Risultato in R: realizzato se chiuso, altrimenti al prezzo dato */
export function rMultiple(t: Trade, price?: number): number | null {
  if (t.fillPrice == null) return null;
  const px = t.exitPrice ?? price;
  if (px == null) return null;
  const risk = riskOf(t);
  if (risk <= 0) return null;
  const move = t.side === 'LONG' ? px - t.fillPrice : t.fillPrice - px;
  return move / risk;
}

export function plannedRR(side: Side, entry: number, stop: number, target: number): number | null {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const reward = side === 'LONG' ? target - entry : entry - target;
  return reward / risk;
}

// ============================================================================
// Statistiche
// ============================================================================

export type ClosedTradeRow = {
  id: string;
  ticker: string;
  timeframe: string;
  side: Side;
  r_multiple: number;
  pnl_pct: number;
  exit_reason: ExitReason;
  mae_r: number | null;
  mfe_r: number | null;
  bars_held: number | null;
  entry_time: number;
  created_at: string;
};

export type Stats = {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  bestR: number;
  worstR: number;
  equity: { i: number; r: number }[];
};

/** Le righe arrivano in ordine cronologico di chiusura */
export function computeStats(rows: ClosedTradeRow[]): Stats {
  const rs = rows.map((r) => Number(r.r_multiple) || 0);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const sumWin = wins.reduce((s, r) => s + r, 0);
  const sumLoss = losses.reduce((s, r) => s + r, 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  const equity: { i: number; r: number }[] = [{ i: 0, r: 0 }];
  rs.forEach((r, i) => {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    equity.push({ i: i + 1, r: Math.round(eq * 100) / 100 });
  });
  return {
    n: rs.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rs.length ? wins.length / rs.length : 0,
    avgR: rs.length ? (sumWin + sumLoss) / rs.length : 0,
    totalR: sumWin + sumLoss,
    avgWinR: wins.length ? sumWin / wins.length : 0,
    avgLossR: losses.length ? sumLoss / losses.length : 0,
    profitFactor: sumLoss < 0 ? sumWin / Math.abs(sumLoss) : null,
    maxDrawdownR: dd,
    bestR: rs.length ? Math.max(...rs) : 0,
    worstR: rs.length ? Math.min(...rs) : 0,
    equity,
  };
}
