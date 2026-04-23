'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type LineData,
  type Time,
  type MouseEventParams,
  type Coordinate,
} from 'lightweight-charts';
import type { OHLCV } from '@/lib/yahoo';
import { Pencil, Trash2, Save, Loader2, Square, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ============================================================================
// Tipi drawing persistibili
// ============================================================================
export type DrawingPoint = { time: number; price: number };

export type TrendlineDrawing = {
  id: string;
  type: 'TRENDLINE';
  p1: DrawingPoint;
  p2: DrawingPoint;
  color: string;
  width: number;
};

export type RectDrawing = {
  id: string;
  type: 'RECT';
  p1: DrawingPoint;
  p2: DrawingPoint;
  color: string;
  fillAlpha: number;
};

export type PositionDrawing = {
  id: string;
  type: 'LONG' | 'SHORT';
  entry: DrawingPoint;
  target: DrawingPoint;
  stop: DrawingPoint;
};

export type Drawing = TrendlineDrawing | RectDrawing | PositionDrawing;

type DrawingTool = null | 'TRENDLINE' | 'RECT' | 'LONG' | 'SHORT';

type Props = {
  ticker: string;
  candles: OHLCV[];
  hma?: (number | null)[];
  theme?: 'dark' | 'light';
};

export default function LightweightChart({
  ticker,
  candles,
  hma,
  theme = 'dark',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const hmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  // Ref che punta sempre all'ultima versione di redrawOverlay.
  // Serve perché le subscribe di lightweight-charts (visibleTimeRangeChange,
  // crosshair) catturano la funzione al momento della subscribe: senza ref
  // chiamerebbero sempre la closure vecchia con drawings=[] al primo render.
  const redrawRef = useRef<() => void>(() => {});

  const [tool, setTool] = useState<DrawingTool>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draftPoints, setDraftPoints] = useState<DrawingPoint[]>([]);
  const [loadingDrawings, setLoadingDrawings] = useState(true);
  const [saving, setSaving] = useState(false);

  // ============================================================================
  // Chart inizializzazione
  // ============================================================================
  useEffect(() => {
    if (!containerRef.current) return;
    const isDark = theme === 'dark';
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: isDark ? '#0b0e12' : '#fff' },
        textColor: isDark ? '#cbd5e1' : '#1e293b',
      },
      grid: {
        vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: isDark ? '#334155' : '#cbd5e1' },
      timeScale: {
        borderColor: isDark ? '#334155' : '#cbd5e1',
        timeVisible: false,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    const hmaSeries = chart.addLineSeries({
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    hmaSeriesRef.current = hmaSeries;

    // Resize handler
    const handleResize = () => {
      if (containerRef.current && chart) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
        redrawRef.current();
      }
    };
    window.addEventListener('resize', handleResize);

    // Redraw overlay quando la timescale cambia (pan/zoom).
    // Passiamo per redrawRef.current per avere sempre lo state aggiornato
    // — se chiamassimo redrawOverlay direttamente, la closure sarebbe
    // fissata a drawings=[] del primo render.
    chart.timeScale().subscribeVisibleTimeRangeChange(() => redrawRef.current());
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawRef.current());
    chart.subscribeCrosshairMove(() => redrawRef.current());

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      hmaSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // ============================================================================
  // Caricamento dati candele
  // ============================================================================
  useEffect(() => {
    if (!candleSeriesRef.current || !hmaSeriesRef.current) return;
    if (candles.length === 0) return;

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.t as UTCTimestamp,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    candleSeriesRef.current.setData(data);

    if (hma) {
      const hmaData: LineData[] = candles
        .map((c, i) => ({
          time: c.t as UTCTimestamp,
          value: hma[i] ?? NaN,
        }))
        .filter((d) => Number.isFinite(d.value)) as LineData[];
      hmaSeriesRef.current.setData(hmaData);
    } else {
      hmaSeriesRef.current.setData([]);
    }

    chartRef.current?.timeScale().fitContent();
    redrawOverlay();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, hma]);

  // ============================================================================
  // Caricamento disegni da API
  // ============================================================================
  useEffect(() => {
    let cancel = false;
    setLoadingDrawings(true);
    fetch(`/api/drawings?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && Array.isArray(d.drawings)) setDrawings(d.drawings);
      })
      .catch(() => {
        if (!cancel) setDrawings([]);
      })
      .finally(() => {
        if (!cancel) setLoadingDrawings(false);
      });
    return () => {
      cancel = true;
    };
  }, [ticker]);

  // ============================================================================
  // Salvataggio disegni (debounced)
  // ============================================================================
  const saveDrawings = useCallback(
    async (next: Drawing[]) => {
      setSaving(true);
      try {
        await fetch('/api/drawings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker, drawings: next }),
        });
      } finally {
        setSaving(false);
      }
    },
    [ticker]
  );

  // ============================================================================
  // Overlay canvas: disegna trendline, rect, long/short sopra il chart
  // ============================================================================
  const redrawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    if (!canvas || !chart || !series || !container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeScale = chart.timeScale();

    function toCanvas(p: DrawingPoint): { x: number; y: number } | null {
      if (!series) return null;
      const x = timeScale.timeToCoordinate(p.time as Time);
      const y = series.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      return { x: x as number, y: y as number };
    }

    // Disegno tutti i drawings completi
    for (const d of drawings) {
      drawShape(ctx, d, toCanvas);
    }

    // Disegno il draft in corso (linea preview mentre stai scegliendo punti)
    if (tool && draftPoints.length > 0) {
      const previewColor = '#60a5fa';
      ctx.save();
      ctx.strokeStyle = previewColor;
      ctx.fillStyle = previewColor;
      ctx.lineWidth = 2;
      for (const p of draftPoints) {
        const c = toCanvas(p);
        if (c) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }, [drawings, tool, draftPoints]);

  // Redraw quando drawings o draft cambiano + sync ref per le subscribe
  useEffect(() => {
    redrawRef.current = redrawOverlay;
    redrawOverlay();
  }, [redrawOverlay]);

  // ============================================================================
  // Input handler per aggiungere punti al drawing in corso.
  // Uso pointer events (unificati mouse/touch/pen) con tracking del punto
  // iniziale: se l'utente ha trascinato (>10px) lo considero un pan, non
  // un click → ignoro. Solo se è un vero tap aggiungo il punto.
  // ============================================================================
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tool) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      pointerDownRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [tool]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tool) return;
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const container = containerRef.current;
      const start = pointerDownRef.current;
      if (!chart || !series || !container || !start) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Ignora se l'utente ha trascinato: era un pan non un tap
      const dx = Math.abs(x - start.x);
      const dy = Math.abs(y - start.y);
      pointerDownRef.current = null;
      if (dx > 10 || dy > 10) return;

      const time = chart.timeScale().coordinateToTime(x);
      const price = series.coordinateToPrice(y);
      if (time == null || price == null) return;

      const point: DrawingPoint = {
        time: time as number,
        price: price as number,
      };
      const nextDraft = [...draftPoints, point];

      const pointsNeeded = tool === 'LONG' || tool === 'SHORT' ? 3 : 2;
      if (nextDraft.length >= pointsNeeded) {
        const newDrawing = buildDrawing(tool, nextDraft);
        if (newDrawing) {
          const next = [...drawings, newDrawing];
          setDrawings(next);
          saveDrawings(next);
        }
        setDraftPoints([]);
        setTool(null);
      } else {
        setDraftPoints(nextDraft);
      }
    },
    [tool, draftPoints, drawings, saveDrawings]
  );

  // ============================================================================
  // Cancella tutti i disegni
  // ============================================================================
  async function clearAll() {
    if (drawings.length === 0) return;
    if (!confirm('Cancellare tutti i disegni su questo ticker?')) return;
    setDrawings([]);
    setDraftPoints([]);
    setTool(null);
    await fetch(`/api/drawings?ticker=${encodeURIComponent(ticker)}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Render UI
  // ============================================================================
  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-brand-border bg-brand-panel/40 flex-wrap">
        <span className="text-xs text-brand-muted font-semibold uppercase tracking-wide px-2">
          Strumenti
        </span>
        <ToolBtn
          active={tool === 'TRENDLINE'}
          onClick={() => {
            setTool(tool === 'TRENDLINE' ? null : 'TRENDLINE');
            setDraftPoints([]);
          }}
          icon={<Minus className="w-3.5 h-3.5" />}
          label="Trendline"
          hint="Clicca 2 punti"
        />
        <ToolBtn
          active={tool === 'RECT'}
          onClick={() => {
            setTool(tool === 'RECT' ? null : 'RECT');
            setDraftPoints([]);
          }}
          icon={<Square className="w-3.5 h-3.5" />}
          label="Rettangolo"
          hint="Clicca 2 angoli opposti"
        />
        <ToolBtn
          active={tool === 'LONG'}
          onClick={() => {
            setTool(tool === 'LONG' ? null : 'LONG');
            setDraftPoints([]);
          }}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Long"
          hint="Entry, Target, Stop"
          color="text-brand-up"
        />
        <ToolBtn
          active={tool === 'SHORT'}
          onClick={() => {
            setTool(tool === 'SHORT' ? null : 'SHORT');
            setDraftPoints([]);
          }}
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          label="Short"
          hint="Entry, Target, Stop"
          color="text-brand-down"
        />
        <div className="flex-1" />
        {saving && (
          <span className="text-xs text-brand-muted flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Salvo…
          </span>
        )}
        {loadingDrawings && !saving && (
          <span className="text-xs text-brand-muted">Carico…</span>
        )}
        {drawings.length > 0 && (
          <>
            <span className="text-xs text-brand-muted">
              {drawings.length} disegn{drawings.length === 1 ? 'o' : 'i'}
            </span>
            <button
              onClick={clearAll}
              className="btn-ghost text-xs"
              title="Cancella tutti"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Hint mentre si disegna */}
      {tool && (
        <div className="px-3 py-1.5 bg-brand-green/10 text-xs text-brand-green border-b border-brand-border">
          <Pencil className="w-3 h-3 inline mr-1" />
          {toolHint(tool, draftPoints.length)} — premi ESC per annullare
        </div>
      )}

      {/* Chart + overlay */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setTool(null);
            setDraftPoints([]);
          }
        }}
        tabIndex={0}
        className="relative outline-none"
        style={{
          cursor: tool ? 'crosshair' : 'default',
          // Quando un tool di disegno è attivo, disabilito il gesto di
          // pan/zoom touch nativo del browser: altrimenti lightweight-charts
          // cattura touchmove e il tap non arriva correttamente su mobile.
          touchAction: tool ? 'none' : 'auto',
        }}
      >
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 5 }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function toolHint(tool: DrawingTool, n: number): string {
  if (tool === 'TRENDLINE') return `Trendline: clicca il punto ${n + 1} di 2`;
  if (tool === 'RECT') return `Rettangolo: clicca l'angolo ${n + 1} di 2`;
  if (tool === 'LONG' || tool === 'SHORT') {
    const labels = ['Entry', 'Target (profit)', 'Stop Loss'];
    return `${tool === 'LONG' ? 'Long' : 'Short'}: clicca ${labels[n]}`;
  }
  return '';
}

function buildDrawing(tool: DrawingTool, points: DrawingPoint[]): Drawing | null {
  const id = crypto.randomUUID();
  if (tool === 'TRENDLINE' && points.length >= 2) {
    return {
      id,
      type: 'TRENDLINE',
      p1: points[0],
      p2: points[1],
      color: '#60a5fa',
      width: 2,
    };
  }
  if (tool === 'RECT' && points.length >= 2) {
    return {
      id,
      type: 'RECT',
      p1: points[0],
      p2: points[1],
      color: '#a78bfa',
      fillAlpha: 0.15,
    };
  }
  if ((tool === 'LONG' || tool === 'SHORT') && points.length >= 3) {
    return {
      id,
      type: tool,
      entry: points[0],
      target: points[1],
      stop: points[2],
    };
  }
  return null;
}

type CanvasMapper = (p: DrawingPoint) => { x: number; y: number } | null;

function drawShape(ctx: CanvasRenderingContext2D, d: Drawing, toCanvas: CanvasMapper) {
  if (d.type === 'TRENDLINE') {
    const a = toCanvas(d.p1);
    const b = toCanvas(d.p2);
    if (!a || !b) return;
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Maniglie ai vertici
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (d.type === 'RECT') {
    const a = toCanvas(d.p1);
    const b = toCanvas(d.p2);
    if (!a || !b) return;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    ctx.save();
    ctx.strokeStyle = d.color;
    ctx.fillStyle = hexToRgba(d.color, d.fillAlpha);
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }

  if (d.type === 'LONG' || d.type === 'SHORT') {
    const entry = toCanvas(d.entry);
    const target = toCanvas(d.target);
    const stop = toCanvas(d.stop);
    if (!entry || !target || !stop) return;

    // Box verde tra entry e target (profit zone)
    const profitColor = '#16a34a';
    const lossColor = '#dc2626';

    const xL = Math.min(entry.x, target.x, stop.x);
    const xR = Math.max(entry.x, target.x, stop.x);
    const w = xR - xL;

    ctx.save();
    // Profit box (entry → target)
    const profitTop = Math.min(entry.y, target.y);
    const profitH = Math.abs(entry.y - target.y);
    ctx.fillStyle = hexToRgba(profitColor, 0.18);
    ctx.strokeStyle = profitColor;
    ctx.lineWidth = 1;
    ctx.fillRect(xL, profitTop, w, profitH);
    ctx.strokeRect(xL, profitTop, w, profitH);

    // Loss box (entry → stop)
    const lossTop = Math.min(entry.y, stop.y);
    const lossH = Math.abs(entry.y - stop.y);
    ctx.fillStyle = hexToRgba(lossColor, 0.18);
    ctx.strokeStyle = lossColor;
    ctx.fillRect(xL, lossTop, w, lossH);
    ctx.strokeRect(xL, lossTop, w, lossH);

    // Linea entry orizzontale
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xL, entry.y);
    ctx.lineTo(xR, entry.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Etichette
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const profitPct = ((d.target.price - d.entry.price) / d.entry.price) * 100;
    const lossPct = ((d.stop.price - d.entry.price) / d.entry.price) * 100;
    const rr = Math.abs(profitPct / lossPct);

    ctx.fillStyle = profitColor;
    ctx.fillText(
      `TARGET ${d.target.price.toFixed(2)} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%)`,
      xR + 6,
      target.y
    );
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`ENTRY ${d.entry.price.toFixed(2)}`, xR + 6, entry.y);
    ctx.fillStyle = lossColor;
    ctx.fillText(
      `STOP ${d.stop.price.toFixed(2)} (${lossPct >= 0 ? '+' : ''}${lossPct.toFixed(1)}%)`,
      xR + 6,
      stop.y
    );

    // R/R label
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText(
      `${d.type} · R/R ${rr.toFixed(2)}`,
      xL + 4,
      Math.min(profitTop, lossTop) - 8
    );
    ctx.restore();
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ToolBtn({
  active,
  onClick,
  icon,
  label,
  hint,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition ${
        active
          ? 'bg-brand-green text-black'
          : `bg-brand-panel/40 ${color ?? 'text-brand-muted'} hover:bg-brand-card`
      }`}
      title={hint}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
