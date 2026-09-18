'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, Side, Trade } from '@/lib/replay-engine';

// ============================================================================
// Disegni del replay: restano nella sessione, non si mescolano con quelli
// salvati sul grafico normale
// ============================================================================
export type RPoint = { time: number; price: number };
export type RDrawing =
  | { id: string; type: 'TRENDLINE'; p1: RPoint; p2: RPoint }
  | { id: string; type: 'RECT'; p1: RPoint; p2: RPoint }
  | { id: string; type: 'FREEHAND'; points: RPoint[] };

export type ReplayTool = null | 'TRENDLINE' | 'RECT' | 'FREEHAND';

/** Ordine in preparazione, mostrato in anteprima sul grafico */
export type TicketPreview = {
  side: Side;
  entry: number;
  stop: number;
  target: number;
} | null;

type Props = {
  bars: Bar[];
  /** Cambia quando cambiano ticker, sessione o timeframe: ricarica completa */
  dataKey: string;
  tfSec: number;
  intraday: boolean;
  trades: Trade[];
  drawings: RDrawing[];
  onAddDrawing: (d: RDrawing) => void;
  tool: ReplayTool;
  onToolDone: () => void;
  pickActive: boolean;
  onPick: (price: number) => void;
  preview: TicketPreview;
};

const COLORS = {
  line: '#60a5fa',
  freehand: '#fbbf24',
  up: 'rgba(34,197,94,',
  down: 'rgba(239,68,68,',
  entry: '#e5e5e5',
};

export default function ReplayChart({
  bars,
  dataKey,
  tfSec,
  intraday,
  trades,
  drawings,
  onAddDrawing,
  tool,
  onToolDone,
  pickActive,
  onPick,
  preview,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const prevRef = useRef<{ key: string; len: number; lastT: number } | null>(null);

  // Ultimi valori sempre leggibili dalle subscribe del grafico
  const barsRef = useRef(bars);
  const tfSecRef = useRef(tfSec);
  const stateRef = useRef({ trades, drawings, preview });
  const draftRef = useRef<RPoint[]>([]);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const redrawRef = useRef<() => void>(() => {});

  barsRef.current = bars;
  tfSecRef.current = tfSec;
  stateRef.current = { trades, drawings, preview };

  // ==========================================================================
  // Conversioni tempo <-> indice logico: permettono di disegnare anche a
  // destra dell'ultima candela, dove il futuro non e' ancora stato mostrato
  // ==========================================================================
  const timeToLogical = useCallback((t: number): number | null => {
    const b = barsRef.current;
    const sec = tfSecRef.current;
    const n = b.length;
    if (n === 0) return null;
    if (t <= b[0].t) return (t - b[0].t) / sec;
    const last = n - 1;
    if (t >= b[last].t) return last + (t - b[last].t) / sec;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo + Math.min(0.99, (t - b[lo].t) / sec);
  }, []);

  const logicalToTime = useCallback((l: number): number | null => {
    const b = barsRef.current;
    const sec = tfSecRef.current;
    const n = b.length;
    if (n === 0) return null;
    if (l <= 0) return b[0].t + l * sec;
    const last = n - 1;
    if (l >= last) return b[last].t + (l - last) * sec;
    const j = Math.floor(l);
    const span = Math.min(sec, b[j + 1].t - b[j].t);
    return b[j].t + (l - j) * span;
  }, []);

  const toXY = useCallback(
    (p: RPoint): { x: number; y: number } | null => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return null;
      const l = timeToLogical(p.time);
      if (l == null) return null;
      const x = chart.timeScale().logicalToCoordinate(l as Logical);
      const y = series.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      return { x, y };
    },
    [timeToLogical]
  );

  const fromXY = useCallback(
    (x: number, y: number): RPoint | null => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return null;
      const l = chart.timeScale().coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      if (l == null || price == null) return null;
      const time = logicalToTime(l);
      if (time == null) return null;
      return { time, price };
    },
    [logicalToTime]
  );

  // ==========================================================================
  // Overlay
  // ==========================================================================
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!canvas || !host || !chart || !series) return;

    const w = host.clientWidth;
    const h = host.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Area del grafico senza la scala prezzi: i riquadri non ci finiscono sopra
    const plotW = chart.timeScale().width();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, h);
    ctx.clip();

    const { trades: trs, drawings: drs, preview: pv } = stateRef.current;
    const n = barsRef.current.length;
    const futureX = chart.timeScale().logicalToCoordinate((n - 1 + 12) as Logical);

    // Posizioni: prima quelle chiuse (tenui), poi pendenti e aperte
    const ordered = [
      ...trs.filter((t) => t.status === 'CLOSED'),
      ...trs.filter((t) => t.status === 'OPEN' || t.status === 'PENDING'),
    ];
    for (const t of ordered) {
      const entry = t.fillPrice ?? t.plannedEntry;
      const a = toXY({ time: t.fillT ?? t.placedT, price: entry });
      if (!a) continue;
      let x2: number | null = null;
      if (t.status === 'CLOSED' && t.exitT != null) x2 = toXY({ time: t.exitT, price: entry })?.x ?? null;
      else x2 = futureX;
      if (x2 == null) continue;
      drawPosition(ctx, {
        x1: a.x,
        x2: Math.max(x2, a.x + 16),
        yEntry: a.y,
        yStop: series.priceToCoordinate(t.stop),
        yTarget: series.priceToCoordinate(t.target),
        faded: t.status === 'CLOSED',
        dashedEntry: t.status === 'PENDING',
        label:
          t.status === 'PENDING'
            ? `${t.orderType === 'LIMIT' ? 'Limit' : 'Stop'} ${fmt(t.plannedEntry)}`
            : t.status === 'CLOSED' && t.exitPrice != null
              ? resultLabel(t)
              : null,
      });
      // Punto di uscita
      if (t.status === 'CLOSED' && t.exitT != null && t.exitPrice != null) {
        const e = toXY({ time: t.exitT, price: t.exitPrice });
        if (e) {
          ctx.fillStyle = t.exitReason === 'TARGET' ? '#22c55e' : t.exitReason === 'STOP' ? '#ef4444' : '#e5e5e5';
          ctx.beginPath();
          ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Anteprima dell'ordine che si sta preparando
    if (pv && n > 0) {
      const lastT = barsRef.current[n - 1].t;
      const a = toXY({ time: lastT, price: pv.entry });
      if (a && futureX != null) {
        drawPosition(ctx, {
          x1: a.x,
          x2: Math.max(futureX, a.x + 16),
          yEntry: a.y,
          yStop: series.priceToCoordinate(pv.stop),
          yTarget: series.priceToCoordinate(pv.target),
          faded: false,
          dashedEntry: true,
          preview: true,
          label: null,
        });
      }
    }

    // Disegni dell'utente
    for (const d of drs) drawShape(ctx, d, toXY);

    // Bozza in corso
    const draft = draftRef.current;
    if (draft.length > 0) {
      if (tool === 'FREEHAND') {
        drawShape(ctx, { id: 'draft', type: 'FREEHAND', points: draft }, toXY);
      } else {
        ctx.fillStyle = COLORS.line;
        for (const p of draft) {
          const c = toXY(p);
          if (!c) continue;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }, [toXY, tool]);

  useEffect(() => {
    redrawRef.current = redraw;
    redraw();
  }, [redraw, trades, drawings, preview]);

  // ==========================================================================
  // Creazione grafico
  // ==========================================================================
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: '#0b0e12' }, textColor: '#cbd5e1' },
      grid: { vertLines: { color: '#1a2230' }, horzLines: { color: '#1a2230' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: {
        borderColor: '#334155',
        rightOffset: 12,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
      priceLineVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onRange = () => redrawRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const ro = new ResizeObserver(() => redrawRef.current());
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      prevRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  // ==========================================================================
  // Dati: aggiornamento incrementale mentre il replay avanza
  // ==========================================================================
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (bars.length === 0) {
      series.setData([]);
      prevRef.current = null;
      return;
    }
    const toCandle = (b: Bar) => ({
      time: b.t as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    });
    const p = prevRef.current;
    const same =
      p != null &&
      p.key === dataKey &&
      bars.length >= p.len &&
      bars[p.len - 1]?.t === p.lastT;
    if (same) {
      for (let i = p.len - 1; i < bars.length; i++) series.update(toCandle(bars[i]));
    } else {
      series.setData(bars.map(toCandle));
      if (!p || p.key !== dataKey) {
        const n = bars.length;
        chart.timeScale().setVisibleLogicalRange({ from: n - 120, to: n + 12 });
      }
    }
    // L'ultima candela e' quella che al prossimo giro potrebbe cambiare
    prevRef.current = { key: dataKey, len: bars.length, lastT: bars[bars.length - 1].t };
    redrawRef.current();
  }, [bars, dataKey]);

  // ==========================================================================
  // Input: strumenti di disegno e selezione dei prezzi dell'ordine
  // ==========================================================================
  const interactive = tool != null || pickActive;

  useEffect(() => {
    draftRef.current = [];
    redrawRef.current();
  }, [tool, pickActive]);

  function localXY(e: React.PointerEvent) {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const p = localXY(e);
    downRef.current = p;
    if (tool === 'FREEHAND') {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const pt = fromXY(p.x, p.y);
      draftRef.current = pt ? [pt] : [];
      redrawRef.current();
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'FREEHAND' || !downRef.current) return;
    const p = localXY(e);
    const last = draftRef.current[draftRef.current.length - 1];
    const lastXY = last ? toXY(last) : null;
    if (lastXY && Math.hypot(lastXY.x - p.x, lastXY.y - p.y) < 3) return;
    const pt = fromXY(p.x, p.y);
    if (pt) {
      draftRef.current = [...draftRef.current, pt];
      redrawRef.current();
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = downRef.current;
    downRef.current = null;
    if (!interactive || !start) return;
    const p = localXY(e);

    if (tool === 'FREEHAND') {
      const pts = draftRef.current;
      draftRef.current = [];
      if (pts.length >= 2) onAddDrawing({ id: uid(), type: 'FREEHAND', points: pts });
      onToolDone();
      return;
    }

    // Un trascinamento non e' un tocco
    if (Math.abs(p.x - start.x) > 10 || Math.abs(p.y - start.y) > 10) return;
    const pt = fromXY(p.x, p.y);
    if (!pt) return;

    if (pickActive) {
      onPick(pt.price);
      return;
    }
    if (tool === 'TRENDLINE' || tool === 'RECT') {
      const next = [...draftRef.current, pt];
      if (next.length >= 2) {
        draftRef.current = [];
        onAddDrawing({ id: uid(), type: tool, p1: next[0], p2: next[1] });
        onToolDone();
      } else {
        draftRef.current = next;
        redrawRef.current();
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative h-[52vh] min-h-[300px] lg:h-[62vh]">
      <div ref={hostRef} className="absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-[5]" />
      <div
        className="absolute inset-0 z-10"
        style={{
          pointerEvents: interactive ? 'auto' : 'none',
          touchAction: interactive ? 'none' : 'auto',
          cursor: interactive ? 'crosshair' : 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          downRef.current = null;
          draftRef.current = [];
          redrawRef.current();
        }}
      />
    </div>
  );
}

// ============================================================================
// Disegno delle forme
// ============================================================================
function drawShape(
  ctx: CanvasRenderingContext2D,
  d: RDrawing,
  toXY: (p: RPoint) => { x: number; y: number } | null
) {
  ctx.save();
  if (d.type === 'FREEHAND') {
    ctx.strokeStyle = COLORS.freehand;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (const p of d.points) {
      const c = toXY(p);
      if (!c) continue;
      if (!started) {
        ctx.moveTo(c.x, c.y);
        started = true;
      } else ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
  } else {
    const a = toXY(d.p1);
    const b = toXY(d.p2);
    if (a && b) {
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1.5;
      if (d.type === 'TRENDLINE') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(96,165,250,0.12)';
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        ctx.fillRect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        ctx.strokeRect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      }
    }
  }
  ctx.restore();
}

function drawPosition(
  ctx: CanvasRenderingContext2D,
  o: {
    x1: number;
    x2: number;
    yEntry: number;
    yStop: number | null;
    yTarget: number | null;
    faded: boolean;
    dashedEntry: boolean;
    preview?: boolean;
    label: string | null;
  }
) {
  if (o.yStop == null || o.yTarget == null) return;
  const alpha = o.faded ? 0.08 : o.preview ? 0.12 : 0.18;
  const w = o.x2 - o.x1;
  ctx.save();
  ctx.fillStyle = `${COLORS.up}${alpha})`;
  ctx.fillRect(o.x1, Math.min(o.yEntry, o.yTarget), w, Math.abs(o.yTarget - o.yEntry));
  ctx.fillStyle = `${COLORS.down}${alpha})`;
  ctx.fillRect(o.x1, Math.min(o.yEntry, o.yStop), w, Math.abs(o.yStop - o.yEntry));

  if (o.preview) {
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `${COLORS.up}0.8)`;
    ctx.beginPath();
    ctx.moveTo(o.x1, o.yTarget);
    ctx.lineTo(o.x2, o.yTarget);
    ctx.stroke();
    ctx.strokeStyle = `${COLORS.down}0.8)`;
    ctx.beginPath();
    ctx.moveTo(o.x1, o.yStop);
    ctx.lineTo(o.x2, o.yStop);
    ctx.stroke();
  }

  ctx.setLineDash(o.dashedEntry ? [5, 4] : []);
  ctx.strokeStyle = o.faded ? 'rgba(229,229,229,0.35)' : COLORS.entry;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x1, o.yEntry);
  ctx.lineTo(o.x2, o.yEntry);
  ctx.stroke();

  if (o.label) {
    ctx.setLineDash([]);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = o.faded ? 'rgba(229,229,229,0.7)' : COLORS.entry;
    ctx.fillText(o.label, o.x1 + 4, o.yEntry - 4);
  }
  ctx.restore();
}

function resultLabel(t: Trade): string {
  const e = t.fillPrice as number;
  const risk = Math.abs(e - t.stop);
  const move = t.side === 'LONG' ? (t.exitPrice as number) - e : e - (t.exitPrice as number);
  const r = risk > 0 ? move / risk : 0;
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

function fmt(x: number): string {
  return x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x.toPrecision(4);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
