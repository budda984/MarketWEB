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
} from 'lucide-react';
import { hma, heikinAshi } from '@/lib/indicators';
import type { OHLCV } from '@/lib/yahoo';
import { MARKETS, type MarketKey, ALL_TICKERS, getMarketForTicker } from '@/lib/tickers';
import { localSearch } from '@/lib/ticker-names';
import AlertsPanel from './AlertsPanel';
import AddToWatchlistButton from './AddToWatchlistButton';
import LightweightChart from './LightweightChart';

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
    longName?: string;
    shortName?: string;
    marketCap?: number;
    peRatio?: number;
    dividendYield?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    sector?: string;
    industry?: string;
  } | null;
  candles: OHLCV[];
};

type Timeframe = '1h' | '4h' | '1d' | '1w';

export default function ChartView({ ticker, onTickerChange }: Props) {
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [browseMarket, setBrowseMarket] = useState<MarketKey | 'none'>('none');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `/api/quote/${encodeURIComponent(ticker)}?tf=${timeframe}`
        );
        const text = await r.text();
        if (cancel) return;
        if (!text) {
          setErr(
            `Ticker ${ticker} non disponibile (può essere delisted o non quotato).`
          );
          return;
        }
        let d: { quote: unknown; candles: unknown; error?: string };
        try {
          d = JSON.parse(text);
        } catch {
          setErr(
            `Ticker ${ticker} non disponibile (risposta non valida dal data provider).`
          );
          return;
        }
        if (d.error) setErr(d.error);
        else setData(d as unknown as QuoteData);
      } catch (e) {
        if (!cancel) setErr(String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [ticker, timeframe]);

  const { candleRows, haRows } = useMemo(() => {
    if (!data?.candles?.length) return { candleRows: [], haRows: [] };
    const closes = data.candles.map((c) => c.c);
    const hmaArr = hma(closes, 50);
    const ha = heikinAshi(data.candles);

    const formatDate = (ts: number): string => {
      const d = new Date(ts * 1000);
      if (timeframe === '1h' || timeframe === '4h') {
        return d.toLocaleString('it-IT', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
      if (timeframe === '1w') {
        return d.toLocaleDateString('it-IT', {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
        });
      }
      return d.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
      });
    };

    const candleRows = data.candles.map((c, i) => ({
      t: c.t * 1000,
      date: formatDate(c.t),
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
      date: formatDate(c.t),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      bullish: c.c >= c.o,
    }));
    return { candleRows, haRows };
  }, [data, timeframe]);

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
          <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
            <select
              value={browseMarket}
              onChange={(e) => setBrowseMarket(e.target.value as MarketKey | 'none')}
              className="input text-xs py-1.5"
            >
              <option value="none">Sfoglia mercato…</option>
              {(Object.keys(MARKETS) as MarketKey[]).map((m) => (
                <option key={m} value={m}>
                  {m} ({MARKETS[m].length})
                </option>
              ))}
            </select>
            {browseMarket !== 'none' && (
              <select
                value={ticker}
                onChange={(e) => onTickerChange(e.target.value)}
                className="input text-xs py-1.5 font-mono max-w-[180px]"
              >
                {(MARKETS[browseMarket] as readonly string[]).map((t, i) => (
                  <option key={t} value={t}>
                    {i + 1}. {t}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Selettore timeframe */}
      <div className="card p-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-brand-muted font-semibold uppercase tracking-wide px-2">
          Timeframe
        </span>
        <div className="flex items-center gap-1 bg-brand-panel rounded p-0.5">
          {(['1h', '4h', '1d', '1w'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 rounded text-xs font-mono font-semibold transition ${
                timeframe === tf
                  ? 'bg-brand-green text-black'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
              title={tfLabel(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <span className="text-xs text-brand-muted hidden sm:inline">
          {tfLabel(timeframe)}
        </span>
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
                      {data.quote.sector && ` · ${data.quote.sector}`}
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold">
                      {data.quote.ticker}
                    </div>
                    {(data.quote.longName || data.quote.shortName) && (
                      <div className="text-sm sm:text-base text-brand-muted mt-0.5 max-w-xs sm:max-w-md truncate">
                        {data.quote.longName ?? data.quote.shortName}
                      </div>
                    )}
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
                <AddToWatchlistButton ticker={data.quote.ticker} />
              </div>
            </div>
          )}

          {/* Card info economiche (solo se almeno un dato esiste) */}
          {data.quote && hasAnyStat(data.quote) && (
            <FundamentalsCard quote={data.quote} />
          )}

          {/* Alert pannello */}
          <AlertsPanel
            ticker={ticker}
            currentPrice={data.quote?.price ?? null}
          />

          {/* Pannello 1: Linea o Candele + HMA 50 */}
          <LightweightChart
            ticker={ticker}
            candles={data.candles}
            hma={data.candles.map((_, i) => {
              const closes = data.candles.map((c) => c.c);
              return hma(closes, 50)[i];
            })}
            theme="dark"
          />

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

type SearchSuggestion = {
  ticker: string;
  name: string;
  exchange?: string;
  type?: string;
};

function InlineSearch({
  defaultValue,
  onChange,
}: {
  defaultValue: string;
  onChange: (s: string) => void;
}) {
  const [v, setV] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  useEffect(() => setV(defaultValue), [defaultValue]);

  // Ricerca locale: zero fetch, istantanea. Cerca sia nel ticker che nel nome
  // dai ticker presenti nel sistema (via TICKER_NAMES).
  useEffect(() => {
    const q = v.trim();
    if (q.length < 1 || q.toUpperCase() === defaultValue.toUpperCase()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const results = localSearch(q, ALL_TICKERS, 10);
    const mapped = results.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      exchange: undefined,
      type: undefined,
    }));
    setSuggestions(mapped);
    setOpen(mapped.length > 0);
  }, [v, defaultValue]);

  function pick(ticker: string) {
    setV(ticker);
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
    onChange(ticker.toUpperCase());
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight].ticker);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(v.toUpperCase());
        setOpen(false);
      }}
      className="flex items-center gap-2 flex-1 relative"
    >
      <div className="flex-1 min-w-0 relative">
        <input
          type="text"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setHighlight(-1);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={handleKey}
          placeholder="AAPL, Apple, BTC…"
          className="input w-full font-mono"
          autoCapitalize="off"
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-brand-panel border border-brand-border rounded-md shadow-lg z-30 max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={s.ticker + i}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.ticker);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 border-b border-brand-border last:border-b-0 transition ${
                  highlight === i
                    ? 'bg-brand-green/15'
                    : 'hover:bg-brand-card/60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-bold text-sm">
                    {s.ticker}
                  </span>
                  <span className="text-xs text-brand-muted">
                    {getMarketForTicker(s.ticker) ?? ''}
                  </span>
                </div>
                <div className="text-xs text-brand-muted truncate">
                  {s.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
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

function tfLabel(tf: string): string {
  switch (tf) {
    case '1h': return 'Orario · ultimi ~60 giorni';
    case '4h': return 'Ogni 4 ore · aggregato da 1h';
    case '1d': return 'Giornaliero · ultimi 6 mesi';
    case '1w': return 'Settimanale · ultimi 5 anni';
    default: return '';
  }
}

function hasAnyStat(q: QuoteData['quote']): boolean {
  if (!q) return false;
  return (
    q.marketCap != null ||
    q.peRatio != null ||
    q.dividendYield != null ||
    q.fiftyTwoWeekHigh != null ||
    q.fiftyTwoWeekLow != null
  );
}

function formatMarketCap(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toFixed(0);
}

function FundamentalsCard({
  quote,
}: {
  quote: NonNullable<QuoteData['quote']>;
}) {
  const rangePct =
    quote.fiftyTwoWeekHigh != null && quote.fiftyTwoWeekLow != null
      ? ((quote.price - quote.fiftyTwoWeekLow) /
          (quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow)) *
        100
      : null;

  return (
    <div className="card p-3 sm:p-4">
      <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-2">
        Fondamentali
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Market Cap"
          value={
            quote.marketCap != null
              ? `${formatMarketCap(quote.marketCap)} ${quote.currency ?? ''}`
              : '—'
          }
        />
        <Stat
          label="P/E ratio"
          value={quote.peRatio != null ? quote.peRatio.toFixed(2) : '—'}
        />
        <Stat
          label="Div. yield"
          value={
            quote.dividendYield != null
              ? `${(quote.dividendYield * 100).toFixed(2)}%`
              : '—'
          }
        />
        <Stat
          label="52w range"
          value={
            quote.fiftyTwoWeekLow != null && quote.fiftyTwoWeekHigh != null
              ? `${quote.fiftyTwoWeekLow.toFixed(2)} – ${quote.fiftyTwoWeekHigh.toFixed(2)}`
              : '—'
          }
          sub={
            rangePct != null
              ? `posizione: ${rangePct.toFixed(0)}% del range`
              : undefined
          }
        />
      </div>
      {(quote.sector || quote.industry) && (
        <div className="mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted">
          {quote.sector}
          {quote.industry && ` · ${quote.industry}`}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-xs text-brand-muted">{label}</div>
      <div className="font-mono text-sm sm:text-base font-semibold">
        {value}
      </div>
      {sub && <div className="text-xs text-brand-muted mt-0.5">{sub}</div>}
    </div>
  );
}
