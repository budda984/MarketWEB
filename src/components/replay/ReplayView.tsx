'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  StepForward,
  FastForward,
  Minus,
  Square,
  PenLine,
  Undo2,
  Trash2,
  Crosshair,
  Loader2,
  Shuffle,
  CalendarSearch,
  RotateCcw,
  X,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  BASE_OPTIONS,
  DISPLAY_FOR_BASE,
  TF_SECONDS,
  applyBar,
  atr,
  basePerDisplay,
  buildBuckets,
  closeManual,
  isIntraday,
  newTrade,
  nextStepCursor,
  plannedRR,
  rMultiple,
  riskOf,
  validateOrder,
  visibleBars,
  type Bar,
  type BaseTf,
  type ClosedTradeRow,
  type DisplayTf,
  type OrderType,
  type Side,
  type Trade,
} from '@/lib/replay-engine';
import ReplayChart, { type RDrawing, type ReplayTool } from './ReplayChart';
import ReplayStats from './ReplayStats';

type Session = {
  id: string;
  ticker: string;
  base: BaseTf;
  name: string | null;
  bars: Bar[];
  /** Se la sessione parte da un gap: ampiezza in percentuale */
  gapPct?: number;
};

type GapRow = {
  ticker: string;
  gap_date: string;
  direction: 'up' | 'down';
  gap_pct: number;
  volume_ratio: number | null;
  filled: boolean;
};

/** Giorni coperti da ciascuna risoluzione: oltre, Yahoo non ha i dati */
const GAP_DAYS: Record<BaseTf, number> = { '1m': 29, '5m': 59, '1h': 729, '1d': 3650 };
const GAP_PERIOD: Record<BaseTf, string> = {
  '1m': 'degli ultimi 30 giorni',
  '5m': 'degli ultimi 60 giorni',
  '1h': 'degli ultimi 2 anni',
  '1d': 'presenti in archivio',
};

type PickField = 'entry' | 'stop' | 'target';

const SPEEDS = [0.5, 1, 2, 4, 8];

const DEFAULT_TF: Record<BaseTf, DisplayTf> = { '1m': '1m', '5m': '5m', '1h': '1h', '1d': '1D' };

export default function ReplayView({ watchlistTickers }: { watchlistTickers: string[] }) {
  const [tab, setTab] = useState<'replay' | 'stats'>('replay');

  // ---- Setup ---------------------------------------------------------------
  const [ticker, setTicker] = useState('AAPL');
  const [base, setBase] = useState<BaseTf>('5m');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState<'manual' | 'gaps'>('manual');
  const [gapMin, setGapMin] = useState('6');
  const [gapDir, setGapDir] = useState<'up' | 'down' | 'all'>('up');
  const [gapList, setGapList] = useState<GapRow[]>([]);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapErr, setGapErr] = useState<string | null>(null);

  // ---- Sessione ------------------------------------------------------------
  const [session, setSession] = useState<Session | null>(null);
  const [tf, setTf] = useState<DisplayTf>('5m');
  const [cursor, setCursor] = useState(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [stopOnClose, setStopOnClose] = useState(true);
  const [drawings, setDrawings] = useState<RDrawing[]>([]);
  const [tool, setTool] = useState<ReplayTool>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ---- Ticket ordine -------------------------------------------------------
  const [ticketSide, setTicketSide] = useState<Side | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [pickField, setPickField] = useState<PickField | null>(null);
  const [ticketErr, setTicketErr] = useState<string | null>(null);

  // ---- Statistiche ---------------------------------------------------------
  const [rows, setRows] = useState<ClosedTradeRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsErr, setRowsErr] = useState<string | null>(null);

  // Ref per il ciclo di play: l'intervallo legge sempre i valori aggiornati
  const sessionRef = useRef(session);
  const cursorRef = useRef(cursor);
  const tradesRef = useRef(trades);
  const playingRef = useRef(playing);
  const stopOnCloseRef = useRef(stopOnClose);
  sessionRef.current = session;
  cursorRef.current = cursor;
  tradesRef.current = trades;
  playingRef.current = playing;
  stopOnCloseRef.current = stopOnClose;

  const buckets = useMemo(() => (session ? buildBuckets(session.bars, tf) : null), [session, tf]);
  const visible = useMemo(
    () => (session && buckets ? visibleBars(session.bars, buckets, cursor) : []),
    [session, buckets, cursor]
  );
  const bpd = useMemo(
    () => (session && buckets ? basePerDisplay(buckets, session.bars.length) : 1),
    [session, buckets]
  );
  const lastBar = session ? session.bars[cursor] : null;
  const atEnd = session ? cursor >= session.bars.length - 1 : false;
  const activeTrades = trades.filter((t) => t.status === 'OPEN' || t.status === 'PENDING');

  // ==========================================================================
  // Statistiche salvate
  // ==========================================================================
  useEffect(() => {
    fetch('/api/replay/trades')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Errore');
        setRows(d.trades ?? []);
      })
      .catch((e) => setRowsErr((e as Error).message))
      .finally(() => setRowsLoading(false));
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const persist = useCallback(
    async (t: Trade) => {
      const s = sessionRef.current;
      if (!s || t.fillPrice == null || t.exitPrice == null) return;
      const risk = riskOf(t);
      const dir = t.side === 'LONG' ? 1 : -1;
      const payload = {
        ticker: s.ticker,
        base_tf: s.base,
        timeframe: t.tf,
        side: t.side,
        order_type: t.orderType,
        planned_entry: t.plannedEntry,
        entry_price: t.fillPrice,
        stop_price: t.stop,
        target_price: t.target,
        exit_price: t.exitPrice,
        exit_reason: t.exitReason,
        r_multiple: rMultiple(t) ?? 0,
        pnl_pct: ((dir * (t.exitPrice - t.fillPrice)) / t.fillPrice) * 100,
        mae_r: risk > 0 ? t.maxAdv / risk : null,
        mfe_r: risk > 0 ? t.maxFav / risk : null,
        bars_held: (t.exitIdx ?? 0) - (t.fillIdx ?? 0),
        entry_time: t.fillT,
        exit_time: t.exitT,
      };
      try {
        const r = await fetch('/api/replay/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Errore');
        setRows((prev) => [...prev, d.trade]);
      } catch (e) {
        showToast(`Trade non salvato nelle statistiche: ${(e as Error).message}`);
      }
    },
    [showToast]
  );

  // ==========================================================================
  // Avanzamento: applica ogni candela base ai trade attivi
  // ==========================================================================
  const advance = useCallback(
    (targetIdx: number, untilEvent = false) => {
      const s = sessionRef.current;
      if (!s) return;
      const from = cursorRef.current;
      const last = s.bars.length - 1;
      const to = Math.min(targetIdx, last);
      if (to <= from) {
        if (from >= last) setPlaying(false);
        return;
      }

      let trs = tradesRef.current;
      let stopAt = to;
      const closed: Trade[] = [];
      let hasActive = trs.some((t) => t.status === 'OPEN' || t.status === 'PENDING');

      if (hasActive) {
        for (let i = from + 1; i <= to; i++) {
          let event = false;
          let closedHere = false;
          trs = trs.map((t) => {
            const u = applyBar(t, s.bars[i], i);
            if (u.status !== t.status) event = true;
            if (u.status === 'CLOSED' && t.status !== 'CLOSED') {
              closed.push(u);
              closedHere = true;
            }
            return u;
          });
          if ((untilEvent && event) || (closedHere && stopOnCloseRef.current && playingRef.current)) {
            stopAt = i;
            break;
          }
          hasActive = trs.some((t) => t.status === 'OPEN' || t.status === 'PENDING');
          if (!hasActive) {
            // Nessun trade da seguire: il resto e' solo scorrimento
            if (untilEvent) stopAt = i;
            break;
          }
        }
      }

      cursorRef.current = stopAt;
      tradesRef.current = trs;
      setCursor(stopAt);
      setTrades(trs);

      if (closed.length > 0) {
        for (const t of closed) persist(t);
        const r = rMultiple(closed[closed.length - 1]) ?? 0;
        showToast(
          `${closed[closed.length - 1].exitReason === 'TARGET' ? 'Target preso' : 'Stop preso'}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`
        );
        if (stopOnCloseRef.current) setPlaying(false);
      }
      if (stopAt >= last) setPlaying(false);
    },
    [persist, showToast]
  );

  // Ciclo di play: la velocita' e' in candele del timeframe mostrato al secondo
  useEffect(() => {
    if (!playing) return;
    let acc = 0;
    const tick = 50;
    const id = setInterval(() => {
      acc += speed * (tick / 1000) * bpd;
      const k = Math.floor(acc);
      if (k >= 1) {
        acc -= k;
        advance(cursorRef.current + k);
      }
    }, tick);
    return () => clearInterval(id);
  }, [playing, speed, bpd, advance]);

  const step = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !buckets) return;
    setPlaying(false);
    advance(nextStepCursor(buckets, cursorRef.current, s.bars.length));
  }, [advance, buckets]);

  // Scorciatoie da tastiera su desktop
  useEffect(() => {
    if (!session || tab !== 'replay') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        step();
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, tab, step]);

  // ==========================================================================
  // Elenco dei gap in apertura, limitato al periodo coperto dalla base
  // ==========================================================================
  useEffect(() => {
    if (setupMode !== 'gaps' || session) return;
    const min = Number(gapMin);
    if (!Number.isFinite(min) || min <= 0) return;
    let cancel = false;
    const id = setTimeout(async () => {
      setGapLoading(true);
      setGapErr(null);
      try {
        const r = await fetch(`/api/replay/gaps?min=${min}&direction=${gapDir}&days=${GAP_DAYS[base]}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Errore');
        if (!cancel) setGapList(d.gaps ?? []);
      } catch (e) {
        if (!cancel) setGapErr((e as Error).message);
      } finally {
        if (!cancel) setGapLoading(false);
      }
    }, 300);
    return () => {
      cancel = true;
      clearTimeout(id);
    };
  }, [setupMode, gapMin, gapDir, base, session]);

  // ==========================================================================
  // Avvio sessione
  // ==========================================================================
  async function startSession(
    opts: { mode: 'date' | 'random' } | { mode: 'gap'; gap: GapRow }
  ) {
    const tk = (opts.mode === 'gap' ? opts.gap.ticker : ticker).trim().toUpperCase();
    if (!tk) {
      setSetupErr('Inserisci un ticker');
      return;
    }
    if (opts.mode === 'date' && !date) {
      setSetupErr('Scegli una data oppure usa la data casuale');
      return;
    }
    setLoading(true);
    setSetupErr(null);
    try {
      const r = await fetch(`/api/replay/candles?ticker=${encodeURIComponent(tk)}&base=${base}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Errore nel caricamento');
      const bars: Bar[] = (d.rows as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
      const n = bars.length;
      if (n < 100) throw new Error(`Storico troppo corto (${n} candele): prova un'altra risoluzione`);

      const warm = Math.min(Math.floor(n * 0.25), 2000);
      let c: number;
      if (opts.mode === 'gap') {
        // Parto dalla prima candela della seduta del gap: il gap si vede,
        // tutto quello che succede dopo l'apertura resta nascosto
        const dayStart = Date.parse(`${opts.gap.gap_date}T00:00:00Z`) / 1000;
        c = bars.findIndex((b) => b.t >= dayStart);
        if (c < 0 || bars[c].t >= dayStart + 86400) {
          throw new Error(
            `Dati ${base} non disponibili per la seduta del ${opts.gap.gap_date}: prova una risoluzione con più storico`
          );
        }
        if (c < 20) throw new Error('Troppo poco storico prima del gap per questa risoluzione');
        if (c >= n - 1) throw new Error('La seduta del gap è l’ultima disponibile: niente da riprodurre');
      } else if (opts.mode === 'random') {
        const hi = Math.floor(n * 0.9);
        c = warm + Math.floor(Math.random() * Math.max(1, hi - warm));
      } else {
        const dayStart = Date.parse(`${date}T00:00:00Z`) / 1000;
        c = -1;
        for (let i = 0; i < n; i++) {
          if (bars[i].t < dayStart) c = i;
          else break;
        }
        const minIdx = 50;
        if (c < minIdx) {
          throw new Error(`Data troppo vicina all'inizio dei dati: scegli dal ${fmtDate(bars[minIdx].t)} in poi`);
        }
        if (c >= n - 2) {
          throw new Error(`Data troppo recente: i dati finiscono il ${fmtDate(bars[n - 1].t)}`);
        }
      }

      setSession({
        id: Math.random().toString(36).slice(2),
        ticker: tk,
        base,
        name: d.name ?? null,
        bars,
        gapPct: opts.mode === 'gap' ? Number(opts.gap.gap_pct) : undefined,
      });
      setTf(DEFAULT_TF[base]);
      setCursor(c);
      cursorRef.current = c;
      setTrades([]);
      tradesRef.current = [];
      setDrawings([]);
      setPlaying(false);
      setTicketSide(null);
      setTool(null);
      setPickField(null);
    } catch (e) {
      setSetupErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function endSession() {
    if (activeTrades.length > 0 && !confirm('Hai trade aperti o ordini pendenti: chiudere la sessione? Non verranno salvati.')) {
      return;
    }
    setPlaying(false);
    setSession(null);
  }

  // ==========================================================================
  // Ticket ordine
  // ==========================================================================
  const suggest = useCallback(
    (side: Side, type: OrderType) => {
      if (!lastBar) return;
      const a = atr(visible, 14) || lastBar.c * 0.01;
      const dir = side === 'LONG' ? 1 : -1;
      let e = lastBar.c;
      if (type === 'LIMIT') e = lastBar.c - dir * a * 0.5;
      if (type === 'STOP') e = lastBar.c + dir * a * 0.5;
      setEntry(roundPx(e));
      setStop(roundPx(e - dir * a * 1.5));
      setTarget(roundPx(e + dir * a * 3));
    },
    [lastBar, visible]
  );

  function openTicket(side: Side) {
    setPlaying(false);
    setTool(null);
    setTicketSide(side);
    setTicketErr(null);
    suggest(side, orderType);
  }

  function closeTicket() {
    setTicketSide(null);
    setPickField(null);
    setTicketErr(null);
  }

  // A mercato l'entrata segue il prezzo corrente
  useEffect(() => {
    if (ticketSide && orderType === 'MARKET' && lastBar) setEntry(roundPx(lastBar.c));
  }, [ticketSide, orderType, lastBar]);

  function submitOrder() {
    if (!ticketSide || !lastBar || !session) return;
    const e = orderType === 'MARKET' ? lastBar.c : Number(entry);
    const s = Number(stop);
    const t = Number(target);
    const err = validateOrder(ticketSide, orderType, e, s, t, lastBar.c);
    if (err) {
      setTicketErr(err);
      return;
    }
    const tr = newTrade(ticketSide, orderType, e, s, t, tf, lastBar, cursor);
    const next = [...trades, tr];
    tradesRef.current = next;
    setTrades(next);
    closeTicket();
  }

  const preview = useMemo(() => {
    if (!ticketSide) return null;
    const e = Number(entry);
    const s = Number(stop);
    const t = Number(target);
    if (![e, s, t].every((x) => Number.isFinite(x) && x > 0)) return null;
    return { side: ticketSide, entry: e, stop: s, target: t };
  }, [ticketSide, entry, stop, target]);

  const rr = preview ? plannedRR(preview.side, preview.entry, preview.stop, preview.target) : null;

  function onPick(price: number) {
    const v = roundPx(price);
    if (pickField === 'entry') setEntry(v);
    if (pickField === 'stop') setStop(v);
    if (pickField === 'target') setTarget(v);
    setPickField(null);
  }

  function closeTrade(id: string) {
    if (!lastBar) return;
    const closed: Trade[] = [];
    const next = trades.map((t) => {
      if (t.id !== id) return t;
      const u = closeManual(t, lastBar, cursor);
      if (u.status === 'CLOSED') closed.push(u);
      return u;
    });
    tradesRef.current = next;
    setTrades(next);
    for (const t of closed) persist(t);
  }

  // ==========================================================================
  // Render
  // ==========================================================================
  const sessionR = trades
    .filter((t) => t.status === 'CLOSED')
    .reduce((s, t) => s + (rMultiple(t) ?? 0), 0);
  const sessionClosed = trades.filter((t) => t.status === 'CLOSED').length;

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-3">
      <div className="inline-flex rounded-md border border-brand-border overflow-hidden text-sm">
        <TabBtn active={tab === 'replay'} onClick={() => setTab('replay')}>
          Replay
        </TabBtn>
        <TabBtn active={tab === 'stats'} onClick={() => setTab('stats')}>
          Statistiche{rows.length > 0 ? ` (${rows.length})` : ''}
        </TabBtn>
      </div>

      {tab === 'stats' && (
        <ReplayStats
          rows={rows}
          loading={rowsLoading}
          error={rowsErr}
          onDelete={async (id) => {
            await fetch(`/api/replay/trades?id=${id}`, { method: 'DELETE' });
            setRows((prev) => prev.filter((r) => r.id !== id));
          }}
          onReset={async () => {
            await fetch('/api/replay/trades?all=1', { method: 'DELETE' });
            setRows([]);
          }}
        />
      )}

      {tab === 'replay' && !session && (
        <div className="card p-4 space-y-4 max-w-xl">
          <div>
            <h2 className="font-semibold">Nuova sessione</h2>
            <p className="text-sm text-brand-muted mt-1">
              Il grafico si ferma alla data scelta e il futuro resta nascosto finché non avanzi.
            </p>
          </div>

          <div className="inline-flex rounded-md border border-brand-border overflow-hidden text-sm">
            <TabBtn active={setupMode === 'manual'} onClick={() => setSetupMode('manual')}>
              Scelgo io
            </TabBtn>
            <TabBtn active={setupMode === 'gaps'} onClick={() => setSetupMode('gaps')}>
              Gap in apertura
            </TabBtn>
          </div>

          {setupMode === 'manual' && (
          <label className="block">
            <span className="text-xs text-brand-muted">Ticker</span>
            <input
              className="input w-full mt-1"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              list="replay-tickers"
              placeholder="AAPL, ENI.MI, BTC-USD…"
              autoCapitalize="characters"
            />
            <datalist id="replay-tickers">
              {watchlistTickers.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          )}

          <div>
            <span className="text-xs text-brand-muted">Dati di partenza</span>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {BASE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setBase(o.key)}
                  className={`text-left px-3 py-2 rounded-md border text-sm transition ${
                    base === o.key
                      ? 'border-brand-green bg-brand-green/10'
                      : 'border-brand-border hover:bg-brand-panel'
                  }`}
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="text-xs text-brand-muted">{o.depth}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-brand-muted mt-2">
              Timeframe disponibili: {DISPLAY_FOR_BASE[base].join(', ')}
            </p>
          </div>

          {setupMode === 'manual' && (
            <>
              <label className="block">
                <span className="text-xs text-brand-muted">Data di partenza</span>
                <input
                  type="date"
                  className="input w-full mt-1"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => startSession({ mode: 'date' })} disabled={loading} className="btn-primary disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarSearch className="w-4 h-4" />}
                  Inizia dalla data
                </button>
                <button onClick={() => startSession({ mode: 'random' })} disabled={loading} className="btn-ghost disabled:opacity-50">
                  <Shuffle className="w-4 h-4" />
                  Data casuale
                </button>
              </div>
            </>
          )}

          {setupMode === 'gaps' && (
            <div className="space-y-3">
              <div className="flex items-end gap-2 flex-wrap">
                <label className="block">
                  <span className="text-xs text-brand-muted">Gap minimo %</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step={0.5}
                    className="input w-24 mt-1 font-mono"
                    value={gapMin}
                    onChange={(e) => setGapMin(e.target.value)}
                  />
                </label>
                <div className="inline-flex rounded-md border border-brand-border overflow-hidden text-sm">
                  <TabBtn active={gapDir === 'up'} onClick={() => setGapDir('up')}>Rialzo</TabBtn>
                  <TabBtn active={gapDir === 'down'} onClick={() => setGapDir('down')}>Ribasso</TabBtn>
                  <TabBtn active={gapDir === 'all'} onClick={() => setGapDir('all')}>Entrambi</TabBtn>
                </div>
              </div>
              <p className="text-xs text-brand-muted">
                Gap sulla chiusura precedente, senza sovrapposizione col giorno prima. Titoli di S&amp;P 500 e NASDAQ,
                sedute {GAP_PERIOD[base]}. La sessione parte dalla prima candela
                del giorno del gap.
              </p>

              {gapLoading && (
                <p className="text-sm text-brand-muted flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cerco i gap…
                </p>
              )}
              {gapErr && <p className="text-sm text-brand-down">{gapErr}</p>}
              {!gapLoading && !gapErr && gapList.length === 0 && (
                <p className="text-sm text-brand-muted">
                  Nessun gap sopra il {gapMin}% in questo periodo. Abbassa la soglia o scegli dati con più storico.
                </p>
              )}

              {gapList.length > 0 && (
                <>
                  <button
                    onClick={() => startSession({ mode: 'gap', gap: gapList[Math.floor(Math.random() * gapList.length)] })}
                    disabled={loading}
                    className="btn-primary disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
                    Gap casuale tra {gapList.length}
                  </button>
                  <div className="max-h-80 overflow-y-auto border border-brand-border rounded-md divide-y divide-brand-border">
                    {gapList.map((g) => (
                      <button
                        key={`${g.ticker}-${g.gap_date}`}
                        onClick={() => startSession({ mode: 'gap', gap: g })}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-brand-panel disabled:opacity-50 text-left"
                      >
                        {g.gap_pct >= 0 ? (
                          <ArrowUpRight className="w-4 h-4 text-brand-up flex-shrink-0" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-brand-down flex-shrink-0" />
                        )}
                        <span className="font-mono font-semibold w-16">{g.ticker}</span>
                        <span className="text-brand-muted text-xs">{fmtIsoDate(g.gap_date)}</span>
                        <span className="flex-1" />
                        {g.volume_ratio != null && (
                          <span className="text-xs text-brand-muted font-mono" title="Volume rispetto alla media a 20 sedute">
                            vol {Number(g.volume_ratio).toFixed(1)}x
                          </span>
                        )}
                        <span className={`font-mono ${g.gap_pct >= 0 ? 'text-brand-up' : 'text-brand-down'}`}>
                          {g.gap_pct >= 0 ? '+' : ''}
                          {Number(g.gap_pct).toFixed(1)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {setupErr && <p className="text-sm text-brand-down">{setupErr}</p>}
        </div>
      )}

      {tab === 'replay' && session && lastBar && (
        <>
          {/* Intestazione sessione */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="font-semibold">
                {session.ticker}
                {session.name && (
                  <span className="text-brand-muted font-normal text-sm ml-2 hidden sm:inline">{session.name}</span>
                )}
              </div>
              <div className="text-xs text-brand-muted font-mono">
                {fmtDateTime(lastBar.t, isIntraday(tf) || session.base !== '1d')} {fmtPx(lastBar.c)}
              </div>
            </div>
            {session.gapPct != null && (
              <span className={`tag ${session.gapPct >= 0 ? 'bg-brand-up/15 text-brand-up' : 'bg-brand-down/15 text-brand-down'}`}>
                Gap {session.gapPct >= 0 ? '+' : ''}
                {session.gapPct.toFixed(1)}%
              </span>
            )}
            <div className="flex-1" />
            {sessionClosed > 0 && (
              <span className={`tag ${sessionR >= 0 ? 'bg-brand-up/15 text-brand-up' : 'bg-brand-down/15 text-brand-down'}`}>
                {sessionClosed} trade, {sessionR >= 0 ? '+' : ''}
                {sessionR.toFixed(2)}R
              </span>
            )}
            <button onClick={endSession} className="btn-ghost text-xs">
              <RotateCcw className="w-3.5 h-3.5" />
              Nuova sessione
            </button>
          </div>

          {/* Timeframe */}
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {DISPLAY_FOR_BASE[session.base].map((k) => (
              <button
                key={k}
                onClick={() => setTf(k)}
                className={`px-3 py-1.5 rounded text-sm font-mono flex-shrink-0 transition ${
                  tf === k ? 'bg-brand-green text-black font-semibold' : 'bg-brand-panel text-brand-text hover:bg-brand-card'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Grafico */}
          <div className="card overflow-hidden relative">
            {(pickField || tool) && (
              <div className="absolute top-2 left-2 right-16 z-20 text-xs bg-brand-panel/95 border border-brand-border rounded px-2 py-1.5 flex items-center gap-2">
                <span className="flex-1">
                  {pickField === 'entry' && 'Tocca il grafico per impostare l’entrata'}
                  {pickField === 'stop' && 'Tocca il grafico per impostare lo stop'}
                  {pickField === 'target' && 'Tocca il grafico per impostare il target'}
                  {!pickField && tool === 'TRENDLINE' && 'Tocca due punti per la trendline'}
                  {!pickField && tool === 'RECT' && 'Tocca due angoli opposti'}
                  {!pickField && tool === 'FREEHAND' && 'Disegna trascinando il dito'}
                </span>
                <button
                  onClick={() => {
                    setPickField(null);
                    setTool(null);
                  }}
                  className="text-brand-muted hover:text-brand-text"
                  aria-label="Annulla"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <ReplayChart
              bars={visible}
              dataKey={`${session.id}:${tf}`}
              tfSec={TF_SECONDS[tf]}
              intraday={isIntraday(tf)}
              trades={trades}
              drawings={drawings}
              onAddDrawing={(d) => setDrawings((prev) => [...prev, d])}
              tool={pickField ? null : tool}
              onToolDone={() => setTool(null)}
              pickActive={pickField != null}
              onPick={onPick}
              preview={preview}
            />
          </div>

          {/* Riproduzione */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setTool(null);
                setPickField(null);
                setPlaying((p) => !p);
              }}
              disabled={atEnd}
              className="btn-primary disabled:opacity-50"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? 'Pausa' : 'Play'}
            </button>
            <button onClick={step} disabled={atEnd} className="btn-ghost disabled:opacity-50">
              <StepForward className="w-4 h-4" />
              Avanti
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="input py-1.5"
              aria-label="Velocità"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} candel{s === 1 ? 'a' : 'e'}/s
                </option>
              ))}
            </select>
            {activeTrades.length > 0 && (
              <button
                onClick={() => {
                  setPlaying(false);
                  advance(Number.MAX_SAFE_INTEGER, true);
                }}
                disabled={atEnd}
                className="btn-ghost disabled:opacity-50"
                title="Salta al prossimo ingresso, stop o target"
              >
                <FastForward className="w-4 h-4" />
                Prossimo evento
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs text-brand-muted ml-auto">
              <input
                type="checkbox"
                checked={stopOnClose}
                onChange={(e) => setStopOnClose(e.target.checked)}
                className="accent-brand-green"
              />
              Pausa quando un trade si chiude
            </label>
          </div>
          {atEnd && <p className="text-xs text-brand-muted">Fine dei dati disponibili per questa risoluzione.</p>}

          {/* Strumenti di disegno */}
          <div className="flex items-center gap-1 flex-wrap">
            <ToolBtn active={tool === 'TRENDLINE'} onClick={() => toggleTool('TRENDLINE')} icon={<Minus className="w-3.5 h-3.5" />} label="Trendline" />
            <ToolBtn active={tool === 'RECT'} onClick={() => toggleTool('RECT')} icon={<Square className="w-3.5 h-3.5" />} label="Rettangolo" />
            <ToolBtn active={tool === 'FREEHAND'} onClick={() => toggleTool('FREEHAND')} icon={<PenLine className="w-3.5 h-3.5" />} label="Mano libera" />
            {drawings.length > 0 && (
              <>
                <ToolBtn active={false} onClick={() => setDrawings((d) => d.slice(0, -1))} icon={<Undo2 className="w-3.5 h-3.5" />} label="Annulla" />
                <ToolBtn active={false} onClick={() => setDrawings([])} icon={<Trash2 className="w-3.5 h-3.5" />} label="Cancella disegni" />
              </>
            )}
          </div>

          {/* Ordini */}
          {!ticketSide && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => openTicket('LONG')}
                disabled={atEnd}
                className="btn justify-center bg-brand-up/15 text-brand-up border border-brand-up/40 hover:bg-brand-up/25 disabled:opacity-50"
              >
                Long
              </button>
              <button
                onClick={() => openTicket('SHORT')}
                disabled={atEnd}
                className="btn justify-center bg-brand-down/15 text-brand-down border border-brand-down/40 hover:bg-brand-down/25 disabled:opacity-50"
              >
                Short
              </button>
            </div>
          )}

          {ticketSide && (
            <div className={`card p-3 space-y-3 border ${ticketSide === 'LONG' ? 'border-brand-up/40' : 'border-brand-down/40'}`}>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${ticketSide === 'LONG' ? 'text-brand-up' : 'text-brand-down'}`}>
                  {ticketSide === 'LONG' ? 'Long' : 'Short'} su {session.ticker}
                </span>
                <div className="flex-1" />
                <button onClick={closeTicket} className="text-brand-muted hover:text-brand-text" aria-label="Chiudi">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="inline-flex rounded-md border border-brand-border overflow-hidden text-sm">
                {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((o) => (
                  <TabBtn
                    key={o}
                    active={orderType === o}
                    onClick={() => {
                      setOrderType(o);
                      suggest(ticketSide, o);
                      setTicketErr(null);
                    }}
                  >
                    {o === 'MARKET' ? 'Mercato' : o === 'LIMIT' ? 'Limit' : 'Stop'}
                  </TabBtn>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <PriceField
                  label="Entrata"
                  value={entry}
                  onChange={setEntry}
                  disabled={orderType === 'MARKET'}
                  picking={pickField === 'entry'}
                  onPick={() => setPickField(pickField === 'entry' ? null : 'entry')}
                />
                <PriceField
                  label="Stop"
                  value={stop}
                  onChange={setStop}
                  picking={pickField === 'stop'}
                  onPick={() => setPickField(pickField === 'stop' ? null : 'stop')}
                />
                <PriceField
                  label="Target"
                  value={target}
                  onChange={setTarget}
                  picking={pickField === 'target'}
                  onPick={() => setPickField(pickField === 'target' ? null : 'target')}
                />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-brand-muted">
                  Rapporto rischio/rendimento{' '}
                  <span className="font-mono text-brand-text">{rr != null && rr > 0 ? `1:${rr.toFixed(2)}` : 'n/d'}</span>
                </span>
                <div className="flex-1" />
                <button onClick={submitOrder} className="btn-primary">
                  {orderType === 'MARKET' ? `Apri ${ticketSide === 'LONG' ? 'long' : 'short'}` : 'Piazza ordine'}
                </button>
              </div>
              {ticketErr && <p className="text-sm text-brand-down">{ticketErr}</p>}
            </div>
          )}

          {/* Trade attivi */}
          {activeTrades.length > 0 && (
            <div className="space-y-2">
              {activeTrades.map((t) => {
                const live = t.status === 'OPEN' ? rMultiple(t, lastBar.c) : null;
                return (
                  <div key={t.id} className="card px-3 py-2 flex items-center gap-3 text-sm">
                    <span className={`font-semibold ${t.side === 'LONG' ? 'text-brand-up' : 'text-brand-down'}`}>
                      {t.side === 'LONG' ? 'Long' : 'Short'}
                    </span>
                    <span className="text-brand-muted text-xs font-mono">{t.tf}</span>
                    <span className="font-mono text-xs">
                      {t.status === 'PENDING'
                        ? `${t.orderType === 'LIMIT' ? 'limit' : 'stop'} ${fmtPx(t.plannedEntry)}`
                        : `in ${fmtPx(t.fillPrice as number)}`}
                    </span>
                    <span className="font-mono text-xs text-brand-muted hidden sm:inline">
                      SL {fmtPx(t.stop)} TP {fmtPx(t.target)}
                    </span>
                    <div className="flex-1" />
                    {live != null && (
                      <span className={`font-mono ${live >= 0 ? 'text-brand-up' : 'text-brand-down'}`}>
                        {live >= 0 ? '+' : ''}
                        {live.toFixed(2)}R
                      </span>
                    )}
                    <button onClick={() => closeTrade(t.id)} className="btn-ghost text-xs py-1">
                      {t.status === 'PENDING' ? 'Annulla ordine' : 'Chiudi'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {toast && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-brand-panel border border-brand-border rounded-md px-4 py-2 text-sm shadow-lg">
              {toast}
            </div>
          )}
        </>
      )}
    </div>
  );

  function toggleTool(t: Exclude<ReplayTool, null>) {
    setPlaying(false);
    setPickField(null);
    setTool((cur) => (cur === t ? null : t));
  }
}

// ============================================================================
// Componenti di supporto
// ============================================================================
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 transition ${active ? 'bg-brand-green text-black font-semibold' : 'bg-brand-panel hover:bg-brand-card'}`}
    >
      {children}
    </button>
  );
}

function ToolBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition ${
        active ? 'bg-brand-green text-black font-semibold' : 'bg-brand-panel text-brand-text hover:bg-brand-card border border-brand-border'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PriceField({
  label,
  value,
  onChange,
  disabled,
  picking,
  onPick,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs text-brand-muted">{label}</span>
      <div className="flex mt-1">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="input w-full min-w-0 rounded-r-none font-mono disabled:opacity-60"
        />
        {!disabled && (
          <button
            type="button"
            onClick={onPick}
            className={`px-2 border border-l-0 border-brand-border rounded-r-md ${
              picking ? 'bg-brand-green text-black' : 'bg-brand-panel text-brand-muted hover:text-brand-text'
            }`}
            aria-label={`Scegli ${label.toLowerCase()} sul grafico`}
            title="Scegli sul grafico"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </div>
    </label>
  );
}

function roundPx(x: number): string {
  const d = x >= 1000 ? 2 : x >= 10 ? 2 : x >= 1 ? 3 : 5;
  return x.toFixed(d);
}

function fmtPx(x: number): string {
  return Number(roundPx(x)).toString();
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

/** I tempi sono gia' in ora di borsa: si leggono come UTC */
function fmtDateTime(t: number, withTime: boolean): string {
  const d = new Date(t * 1000);
  const date = `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  if (!withTime) return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDate(t: number): string {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
