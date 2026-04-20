'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Bar,
} from 'recharts';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  LineChart as LineChartIcon,
  CandlestickChart,
} from 'lucide-react';
import { hma, heikinAshi } from '@/lib/indicators';
import type { OHLCV } from '@/lib/yahoo';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import AlertsPanel from './AlertsPanel';

type Props = {
  ticker: string;
  onTickerChange?: (t: string) => void;
};

type QuoteData = {
  quote: {
    ticker: string;
    price: number;
    previousClose: number;
    changePct: number;
    currency?: string;
    exchange?: string;
  } | null;
  candles: OHLCV[];
};

type ChartMode = 'line' | 'candles';

export default function ChartView({ ticker, onTickerChange }: Props) {
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [browseMarket, setBrowseMarket] = useState<MarketKey | 'none'>('none');
  const [chartMode, setChartMode] = useState<ChartMode>('line');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/quote/${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancel) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch((e) => !cancel && setErr(String(e)))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [ticker]);

  // Navigazione: se il browseMarket è selezionato, calcolo indice del ticker corrente
  const { browseIndex, browseTotal, browsePrev, browseNext } = useMemo(() => {
    if (browseMarket === 'none') {
      return { browseIndex: -1, browseTotal: 0, browsePrev: null, browseNext: null };
    }
    const list = MARKETS[browseMarket];
    const idx = list.indexOf(ticker);
    const total = list.length;
    const prev = idx > 0 ? list[idx - 1] : list[total - 1]; // wrap
    const next = idx < total - 1 ? list[idx + 1] : list[0]; // wrap
    return {
      browseIndex: idx,
      browseTotal: total,
      browsePrev: prev,
      browseNext: next,
    };
  }, [browseMarket, ticker]);

  const { candleRows, haRows } = useMemo(() => {
    if (!data?.candles?.length) return { candleRows: [], haRows: [] };
    const closes = data.candles.map((c) => c.c);
    const hmaArr = hma(closes, 50);
    const ha = heikinAshi(data.candles);
    const candleRows = data.candles.map((c, i) => ({
      t: c.t * 1000,
      date: new Date(c.t * 1000).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
      }),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
      hma: hmaArr[i],
      bullish: c.c >= c.o,
    }));
    const haRows = ha.map((c) => ({
      t: c.t * 1000,
      date: new Date(c.t * 1000).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
      }),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      bullish: c.c >= c.o,
    }));
    return { candleRows, haRows };
  }, [data]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Navigazione mercato + search */}
      <div className="card p-3 flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-brand-muted flex-shrink-0" />
          {onTickerChange ? (
            <InlineSearch defaultValue={ticker} onChange={onTickerChange} />
          ) : (
            <span className="font-mono font-bold">{ticker}</span>
          )}
        </div>

        {onTickerChange && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <select
              value={browseMarket}
              onChange={(e) => setBrowseMarket(e.target.value as MarketKey | 'none')}
              className="input text-xs py-1.5 flex-1 sm:flex-none"
            >
              <option value="none">Sfoglia mercato…</option>
              {(Object.keys(MARKETS) as MarketKey[]).map((m) => (
                <option key={m} value={m}>
                  {m} ({MARKETS[m].length})
                </option>
              ))}
            </select>
            {browseMarket !== 'none' && browsePrev && browseNext && (
              <>
                <button
                  onClick={() => onTickerChange(browsePrev)}
                  className="btn-ghost p-1.5 text-xs"
                  title="Precedente"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-brand-muted whitespace-nowrap px-1">
                  {browseIndex >= 0 ? browseIndex + 1 : '—'}/{browseTotal}
                </span>
                <button
                  onClick={() => onTickerChange(browseNext)}
                  className="btn-ghost p-1.5 text-xs"
                  title="Successivo"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="p-10 text-center text-brand-muted text-sm">
          Caricamento {ticker}…
        </div>
      )}
      {err && (
        <div className="p-10 text-center text-brand-down text-sm">
          Errore per {ticker}: {err}
        </div>
      )}

      {!loading && !err && data && candleRows.length > 0 && (
        <>
          {/* Header prezzi */}
          {data.quote && (
            <div className="card p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-3 sm:gap-6">
                <div className="flex items-baseline justify-between sm:block">
                  <div>
                    <div className="text-brand-muted text-xs">
                      {data.quote.exchange}
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold">
                      {data.quote.ticker}
                    </div>
                  </div>
                  <div
                    className={`text-lg font-mono sm:hidden ${
                      data.quote.changePct >= 0
                        ? 'text-brand-up'
                        : 'text-brand-down'
                    }`}
                  >
                    {data.quote.changePct >= 0 ? '▲' : '▼'}{' '}
                    {data.quote.changePct.toFixed(2)}%
                  </div>
                </div>

                <div className="text-3xl sm:text-4xl font-mono font-bold">
                  {data.quote.price.toFixed(2)}
                  <span className="text-sm sm:text-base text-brand-muted ml-2">
                    {data.quote.currency}
                  </span>
                </div>

                <div
                  className={`hidden sm:block text-lg font-mono ${
                    data.quote.changePct >= 0
                      ? 'text-brand-up'
                      : 'text-brand-down'
                  }`}
                >
                  {data.quote.changePct >= 0 ? '▲' : '▼'}{' '}
                  {data.quote.changePct.toFixed(2)}%
                </div>
                <div className="text-xs sm:text-sm text-brand-muted sm:ml-auto">
                  Prev close: {data.quote.previousClose.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Alert pannello */}
          <AlertsPanel
            ticker={ticker}
            currentPrice={data.quote?.price ?? null}
          />

          {/* Pannello 1: Linea o Candele + HMA 50 */}
          <div className="card p-3 sm:p-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <h3 className="text-xs sm:text-sm font-semibold text-brand-muted uppercase tracking-wide">
                {chartMode === 'line' ? 'Linea' : 'Candlestick'} + Hull MA 50
              </h3>
              <div className="flex items-center gap-1 bg-brand-panel rounded p-0.5">
                <button
                  onClick={() => setChartMode('line')}
                  className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
                    chartMode === 'line'
                      ? 'bg-brand-green text-black font-semibold'
                      : 'text-brand-muted hover:text-brand-text'
                  }`}
                  title="Vista linea"
                >
                  <LineChartIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Linea</span>
                </button>
                <button
                  onClick={() => setChartMode('candles')}
                  className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
                    chartMode === 'candles'
                      ? 'bg-brand-green text-black font-semibold'
                      : 'text-brand-muted hover:text-brand-text'
                  }`}
                  title="Vista candele"
                >
                  <CandlestickChart className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Candele</span>
                </button>
              </div>
            </div>

            <div className="h-64 sm:h-80 lg:h-96">
              {chartMode === 'line' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={candleRows}>
                    <CartesianGrid stroke="#1e222d" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      stroke="#6a6a6a"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                      minTickGap={20}
                    />
                    <YAxis
                      yAxisId="price"
                      stroke="#6a6a6a"
                      tick={{ fontSize: 10 }}
                      domain={['auto', 'auto']}
                      orientation="right"
                      width={45}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#181818',
                        border: '1px solid #2a2a2a',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#9a9a9a' }}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="close"
                      stroke="#e5e5e5"
                      strokeWidth={1.5}
                      dot={false}
                      name="Close"
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="hma"
                      stroke="#1DB954"
                      strokeWidth={2}
                      dot={false}
                      name="HMA 50"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <CandleChart rows={candleRows} withHMA />
              )}
            </div>
          </div>

          {/* Pannello 2: Heikin Ashi */}
          <div className="card p-3 sm:p-5">
            <h3 className="text-xs sm:text-sm font-semibold text-brand-muted mb-2 sm:mb-3 uppercase tracking-wide">
              Heikin Ashi
            </h3>
            <div className="h-48 sm:h-64 lg:h-72">
              <HeikinAshiChart rows={haRows} />
            </div>
          </div>

          {/* Pannello 3: Volume */}
          <div className="card p-3 sm:p-5">
            <h3 className="text-xs sm:text-sm font-semibold text-brand-muted mb-2 sm:mb-3 uppercase tracking-wide">
              Volume
            </h3>
            <div className="h-28 sm:h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={candleRows}>
                  <CartesianGrid stroke="#1e222d" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    stroke="#6a6a6a"
                    tick={{ fontSize: 10 }}
                    minTickGap={20}
                  />
                  <YAxis
                    stroke="#6a6a6a"
                    tick={{ fontSize: 10 }}
                    orientation="right"
                    width={45}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#181818',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                    }}
                  />
                  <Bar dataKey="volume" fill="#2a2a2a" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InlineSearch({
  defaultValue,
  onChange,
}: {
  defaultValue: string;
  onChange: (s: string) => void;
}) {
  const [v, setV] = useState(defaultValue);
  useEffect(() => setV(defaultValue), [defaultValue]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(v.toUpperCase());
      }}
      className="flex items-center gap-2 flex-1"
    >
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="AAPL, BTC-USD…"
        className="input flex-1 min-w-0 font-mono"
        autoCapitalize="characters"
      />
      <button type="submit" className="btn-ghost flex-shrink-0 text-xs">
        Apri
      </button>
    </form>
  );
}

/**
 * Candle chart SVG responsive. Disegna candele OHLC con wicks e HMA overlay.
 */
function CandleChart({
  rows,
  withHMA,
}: {
  rows: Array<{
    t: number;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    bullish: boolean;
    hma?: number | null;
  }>;
  withHMA?: boolean;
}) {
  if (rows.length === 0) return null;

  const W = 1400;
  const H = 400;
  const PADDING = { top: 10, right: 55, bottom: 30, left: 10 };
  const plotW = W - PADDING.left - PADDING.right;
  const plotH = H - PADDING.top - PADDING.bottom;

  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const minY = Math.min(...lows);
  const maxY = Math.max(...highs);
  const pad = (maxY - minY) * 0.05 || 1;
  const yMin = minY - pad;
  const yMax = maxY + pad;
  const range = yMax - yMin;

  const bw = plotW / rows.length;
  const cw = Math.max(1.5, bw * 0.7);
  const yScale = (v: number) =>
    PADDING.top + ((yMax - v) / range) * plotH;

  const yTicks = 6;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = yMin + (range * i) / yTicks;
    return { val, y: yScale(val) };
  });

  // HMA line path
  let hmaPath = '';
  if (withHMA) {
    const pts = rows
      .map((r, i) => {
        if (r.hma == null || !Number.isFinite(r.hma)) return null;
        const x = PADDING.left + i * bw + bw / 2;
        const y = yScale(r.hma);
        return [x, y] as [number, number];
      })
      .filter((p): p is [number, number] => p !== null);
    if (pts.length > 0) {
      hmaPath =
        'M ' +
        pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');
    }
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      {/* Griglia orizzontale */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={PADDING.left}
            x2={W - PADDING.right}
            y1={t.y}
            y2={t.y}
            stroke="#1e222d"
            strokeDasharray="3 3"
          />
          <text
            x={W - PADDING.right + 6}
            y={t.y + 3}
            fill="#6a6a6a"
            fontSize={10}
            fontFamily="monospace"
          >
            {t.val.toFixed(2)}
          </text>
        </g>
      ))}

      {/* Candele */}
      {rows.map((r, i) => {
        const x = PADDING.left + i * bw + bw / 2;
        const yOpen = yScale(r.open);
        const yClose = yScale(r.close);
        const yHigh = yScale(r.high);
        const yLow = yScale(r.low);
        const color = r.bullish ? '#1DB954' : '#ef4444';
        const top = Math.min(yOpen, yClose);
        const h = Math.max(1, Math.abs(yClose - yOpen));
        return (
          <g key={i}>
            {/* Wick */}
            <line
              x1={x}
              x2={x}
              y1={yHigh}
              y2={yLow}
              stroke={color}
              strokeWidth={1}
            />
            {/* Body */}
            <rect x={x - cw / 2} y={top} width={cw} height={h} fill={color} />
          </g>
        );
      })}

      {/* HMA overlay */}
      {hmaPath && (
        <path
          d={hmaPath}
          fill="none"
          stroke="#1DB954"
          strokeWidth={2}
          opacity={0.9}
        />
      )}

      {/* Label X */}
      {rows
        .filter((_, i) => i % Math.ceil(rows.length / 8) === 0)
        .map((r, i) => {
          const idx = rows.findIndex((x) => x.t === r.t);
          const x = PADDING.left + idx * bw + bw / 2;
          return (
            <text
              key={i}
              x={x}
              y={H - 10}
              fill="#6a6a6a"
              fontSize={10}
              textAnchor="middle"
              fontFamily="monospace"
            >
              {r.date}
            </text>
          );
        })}
    </svg>
  );
}

/**
 * SVG Heikin Ashi
 */
function HeikinAshiChart({
  rows,
}: {
  rows: Array<{
    t: number;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    bullish: boolean;
  }>;
}) {
  if (rows.length === 0) return null;
  return <CandleChart rows={rows} />;
}
