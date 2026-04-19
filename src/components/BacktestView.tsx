'use client';

import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { Play, Save, TrendingUp, TrendingDown, Target, Clock } from 'lucide-react';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import type { BacktestResult } from '@/lib/backtest';

type Props = { initialMarkets: MarketKey[] };

export default function BacktestView({ initialMarkets }: Props) {
  const [markets, setMarkets] = useState<MarketKey[]>(initialMarkets);
  const [period, setPeriod] = useState<'6mo' | '1y' | '2y' | '5y'>('1y');
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(10);
  const [maxHold, setMaxHold] = useState(20);
  const [saveName, setSaveName] = useState('');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (save: boolean) => {
    setRunning(true);
    setErr(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets,
          period,
          params: {
            stopLossPct: stopLoss,
            takeProfitPct: takeProfit,
            maxHoldDays: maxHold,
          },
          saveAs: save && saveName ? saveName : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      setResult(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const equityData = result?.equity.map((p) => ({
    t: p.t * 1000,
    date: new Date(p.t * 1000).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
    }),
    equity: p.value,
  })) ?? [];

  const pnlDist = result?.trades.map((t, i) => ({
    i,
    ticker: t.ticker,
    pnl: t.pnlPct,
  })) ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Form parametri */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold">Parametri Backtest</h3>

        <div>
          <label className="block text-xs text-brand-muted mb-2 uppercase tracking-wide">
            Universo
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MARKETS) as MarketKey[]).map((m) => {
              const on = markets.includes(m);
              return (
                <button
                  key={m}
                  onClick={() =>
                    setMarkets((prev) =>
                      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
                    )
                  }
                  className={`px-3 py-1.5 rounded text-sm transition ${
                    on
                      ? 'bg-brand-green text-black'
                      : 'bg-brand-panel text-brand-muted hover:bg-brand-card'
                  }`}
                >
                  {m} ({MARKETS[m].length})
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Periodo storico">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="input w-full"
            >
              <option value="6mo">6 mesi</option>
              <option value="1y">1 anno</option>
              <option value="2y">2 anni</option>
              <option value="5y">5 anni</option>
            </select>
          </Field>
          <Field label="Stop Loss %">
            <input
              type="number"
              step="0.5"
              min={0.5}
              value={stopLoss}
              onChange={(e) => setStopLoss(Number(e.target.value))}
              className="input w-full"
            />
          </Field>
          <Field label="Take Profit %">
            <input
              type="number"
              step="0.5"
              min={0.5}
              value={takeProfit}
              onChange={(e) => setTakeProfit(Number(e.target.value))}
              className="input w-full"
            />
          </Field>
          <Field label="Max Hold (giorni)">
            <input
              type="number"
              min={1}
              value={maxHold}
              onChange={(e) => setMaxHold(Number(e.target.value))}
              className="input w-full"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={() => run(false)}
            disabled={running || markets.length === 0}
            className="btn-primary disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> {running ? 'In esecuzione…' : 'Esegui backtest'}
          </button>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Nome scenario…"
            className="input flex-1 min-w-[200px]"
          />
          <button
            onClick={() => run(true)}
            disabled={running || !saveName || markets.length === 0}
            className="btn-ghost disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Salva scenario
          </button>
        </div>

        {err && (
          <p className="text-sm text-brand-down bg-brand-down/10 p-2 rounded">
            {err}
          </p>
        )}
      </div>

      {/* Stats + equity */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Target className="w-5 h-5" />}
              label="Trade totali"
              value={result.stats.totalTrades.toString()}
              sub={`${result.stats.wins}W / ${result.stats.losses}L`}
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5 text-brand-up" />}
              label="Win rate"
              value={`${result.stats.winRate.toFixed(1)}%`}
              sub={`Avg P&L ${result.stats.avgPnl.toFixed(2)}%`}
            />
            <StatCard
              icon={
                result.stats.totalPnl >= 0 ? (
                  <TrendingUp className="w-5 h-5 text-brand-up" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-brand-down" />
                )
              }
              label="P&L cumulativo"
              value={`${result.stats.totalPnl >= 0 ? '+' : ''}${result.stats.totalPnl.toFixed(2)}%`}
              sub={`Max DD ${result.stats.maxDrawdown.toFixed(2)}%`}
              valueClass={
                result.stats.totalPnl >= 0 ? 'text-brand-up' : 'text-brand-down'
              }
            />
            <StatCard
              icon={<Clock className="w-5 h-5" />}
              label="Barre medie tenute"
              value={result.stats.avgBarsHeld.toFixed(1)}
              sub="giorni per trade"
            />
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-brand-muted mb-3 uppercase tracking-wide">
              Equity Curve
            </h3>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={equityData}>
                  <CartesianGrid stroke="#1e222d" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6a6a6a" tick={{ fontSize: 10 }} />
                  <YAxis
                    stroke="#6a6a6a"
                    tick={{ fontSize: 10 }}
                    orientation="right"
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#181818',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toFixed(2)}%`, 'Equity']}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#1DB954"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-brand-muted mb-3 uppercase tracking-wide">
              Distribuzione P&L trade
            </h3>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={pnlDist}>
                  <CartesianGrid stroke="#1e222d" strokeDasharray="3 3" />
                  <XAxis dataKey="i" stroke="#6a6a6a" tick={{ fontSize: 10 }} />
                  <YAxis
                    stroke="#6a6a6a"
                    tick={{ fontSize: 10 }}
                    orientation="right"
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#181818',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: number, _n, p) => [
                      `${v.toFixed(2)}%`,
                      p.payload.ticker,
                    ]}
                    labelFormatter={() => ''}
                  />
                  <Bar dataKey="pnl">
                    {pnlDist.map((d, i) => (
                      <Cell
                        key={i}
                        fill={d.pnl >= 0 ? '#1DB954' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-brand-border font-semibold text-sm">
              Trade log ({result.trades.length})
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-brand-panel sticky top-0">
                  <tr className="text-brand-muted text-left">
                    <th className="px-4 py-2">Ticker</th>
                    <th className="px-4 py-2">Entry</th>
                    <th className="px-4 py-2">Exit</th>
                    <th className="px-4 py-2">Giorni</th>
                    <th className="px-4 py-2">Outcome</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(0, 200).map((t, i) => (
                    <tr
                      key={i}
                      className="border-t border-brand-border hover:bg-brand-panel/50"
                    >
                      <td className="px-4 py-2 font-bold">{t.ticker}</td>
                      <td className="px-4 py-2 font-mono">
                        {new Date(t.entryDate * 1000).toLocaleDateString('it-IT')}{' '}
                        <span className="text-brand-muted">
                          @ {t.entryPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {new Date(t.exitDate * 1000).toLocaleDateString('it-IT')}{' '}
                        <span className="text-brand-muted">
                          @ {t.exitPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">{t.barsHeld}</td>
                      <td className="px-4 py-2">
                        <OutcomeTag outcome={t.outcome} />
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono font-bold ${
                          t.pnlPct >= 0 ? 'text-brand-up' : 'text-brand-down'
                        }`}
                      >
                        {t.pnlPct >= 0 ? '+' : ''}
                        {t.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-brand-muted mb-1 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-brand-muted text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono mt-1 ${valueClass ?? ''}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-brand-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function OutcomeTag({ outcome }: { outcome: 'TP' | 'SL' | 'TIME' }) {
  const map = {
    TP: { label: '🎯 TP', cls: 'bg-brand-up/20 text-brand-up' },
    SL: { label: '🛑 SL', cls: 'bg-brand-down/20 text-brand-down' },
    TIME: { label: '⏰ Time', cls: 'bg-yellow-400/20 text-yellow-400' },
  };
  const c = map[outcome];
  return <span className={`tag ${c.cls}`}>{c.label}</span>;
}
