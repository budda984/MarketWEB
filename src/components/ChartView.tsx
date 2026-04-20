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
import { Search } from 'lucide-react';
import { hma, heikinAshi } from '@/lib/indicators';
import type { OHLCV } from '@/lib/yahoo';

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

export default function ChartView({ ticker, onTickerChange }: Props) {
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
      {/* Ricerca ticker visibile solo in mobile (desktop ce l'ha nell'header) */}
      {onTickerChange && (
        <div className="sm:hidden">
          <MobileTickerSearch defaultValue={ticker} onChange={onTickerChange} />
        </div>
      )}

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
          {/* Header prezzi — impilato verticalmente in mobile, orizzontale desktop */}
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
                  {/* Variazione affianco in mobile */}
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

                {/* Variazione desktop */}
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

          {/* Pannello 1: Candle + HMA 50 */}
          <div className="card p-3 sm:p-5">
            <h3 className="text-xs sm:text-sm font-semibold text-brand-muted mb-2 sm:mb-3 uppercase tracking-wide">
              Candlestick + Hull MA 50
            </h3>
            <div className="h-64 sm:h-80 lg:h-96">
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

/** Search ticker dedicato per mobile (form full-width) */
function MobileTickerSearch({
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
      className="card p-3 flex items-center gap-2"
    >
      <Search className="w-4 h-4 text-brand-muted flex-shrink-0" />
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="AAPL, BTC-USD, ENI.MI…"
        className="input flex-1"
        autoCapitalize="characters"
      />
      <button type="submit" className="btn-ghost flex-shrink-0">
        Apri
      </button>
    </form>
  );
}

/**
 * SVG Heikin Ashi: già responsivo grazie al viewBox + preserveAspectRatio.
 * Rendo gli assi più compatti in mobile.
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

  const W = 1200;
  const H = 280;
  const PADDING = { top: 10, right: 50, bottom: 30, left: 10 };
  const plotW = W - PADDING.left - PADDING.right;
  const plotH = H - PADDING.top - PADDING.bottom;

  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const minY = Math.min(...lows);
  const maxY = Math.max(...highs);
  const range = maxY - minY || 1;

  const bw = plotW / rows.length;
  const cw = Math.max(1, bw * 0.7);
  const yScale = (v: number) => PADDING.top + ((maxY - v) / range) * plotH;

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = minY + (range * i) / yTicks;
    return { val, y: yScale(val) };
  });

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
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
            <line
              x1={x}
              x2={x}
              y1={yHigh}
              y2={yLow}
              stroke={color}
              strokeWidth={1}
            />
            <rect x={x - cw / 2} y={top} width={cw} height={h} fill={color} />
          </g>
        );
      })}

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
