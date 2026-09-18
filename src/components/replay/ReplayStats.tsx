'use client';

import { useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { computeStats, type ClosedTradeRow } from '@/lib/replay-engine';

type Props = {
  rows: ClosedTradeRow[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => Promise<void>;
  onReset: () => Promise<void>;
};

const REASON: Record<string, string> = {
  TARGET: 'Target',
  STOP: 'Stop',
  MANUALE: 'Manuale',
  FINE_DATI: 'Fine dati',
};

export default function ReplayStats({ rows, loading, error, onDelete, onReset }: Props) {
  const [tickerF, setTickerF] = useState('');
  const [tfF, setTfF] = useState('');
  const [sideF, setSideF] = useState('');

  const tickers = useMemo(() => Array.from(new Set(rows.map((r) => r.ticker))).sort(), [rows]);
  const tfs = useMemo(() => Array.from(new Set(rows.map((r) => r.timeframe))), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (!tickerF || r.ticker === tickerF) && (!tfF || r.timeframe === tfF) && (!sideF || r.side === sideF)
      ),
    [rows, tickerF, tfF, sideF]
  );
  const s = useMemo(() => computeStats(filtered), [filtered]);

  if (loading) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-brand-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Carico le statistiche…
      </div>
    );
  }
  if (error) {
    return (
      <div className="card p-4 text-sm">
        <p className="text-brand-down">Statistiche non disponibili: {error}</p>
        <p className="text-brand-muted mt-1">Se la tabella non esiste ancora, esegui la migration 019 su Supabase.</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="card p-4 text-sm text-brand-muted">
        Nessun trade ancora. Apri una sessione di replay: ogni trade chiuso finisce qui.
      </div>
    );
  }

  const recent = [...filtered].reverse().slice(0, 100);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select className="input py-1.5" value={tickerF} onChange={(e) => setTickerF(e.target.value)} aria-label="Ticker">
          <option value="">Tutti i ticker</option>
          {tickers.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="input py-1.5" value={tfF} onChange={(e) => setTfF(e.target.value)} aria-label="Timeframe">
          <option value="">Tutti i timeframe</option>
          {tfs.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="input py-1.5" value={sideF} onChange={(e) => setSideF(e.target.value)} aria-label="Direzione">
          <option value="">Long e short</option>
          <option value="LONG">Solo long</option>
          <option value="SHORT">Solo short</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Trade" value={`${s.n}`} sub={`${s.wins} vinti, ${s.losses} persi`} />
        <Metric label="Win rate" value={`${(s.winRate * 100).toFixed(0)}%`} />
        <Metric label="Media per trade" value={fmtR(s.avgR)} tone={s.avgR} />
        <Metric label="Totale" value={fmtR(s.totalR)} tone={s.totalR} />
        <Metric label="Profit factor" value={s.profitFactor == null ? 'n/d' : s.profitFactor.toFixed(2)} />
        <Metric label="Drawdown massimo" value={`${s.maxDrawdownR.toFixed(2)}R`} />
        <Metric label="Vincita media" value={fmtR(s.avgWinR)} tone={1} />
        <Metric label="Perdita media" value={fmtR(s.avgLossR)} tone={-1} />
      </div>

      <div className="card p-3">
        <div className="text-sm font-medium mb-2">Curva dei risultati in R</div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={s.equity} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
              <XAxis dataKey="i" stroke="#9a9a9a" fontSize={11} />
              <YAxis stroke="#9a9a9a" fontSize={11} />
              <ReferenceLine y={0} stroke="#555" />
              <Tooltip
                contentStyle={{ background: '#181818', border: '1px solid #2a2a2a', fontSize: 12 }}
                formatter={(v: number) => [`${v}R`, 'Totale']}
                labelFormatter={(l) => `Trade ${l}`}
              />
              <Line type="monotone" dataKey="r" stroke="#1DB954" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-brand-muted">
            <tr className="border-b border-brand-border">
              <th className="text-left px-3 py-2 font-medium">Ticker</th>
              <th className="text-left px-2 py-2 font-medium">Lato</th>
              <th className="text-left px-2 py-2 font-medium">TF</th>
              <th className="text-left px-2 py-2 font-medium">Uscita</th>
              <th className="text-right px-2 py-2 font-medium">R</th>
              <th className="text-right px-2 py-2 font-medium hidden sm:table-cell">MFE</th>
              <th className="text-right px-2 py-2 font-medium hidden sm:table-cell">MAE</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-b border-brand-border/60">
                <td className="px-3 py-1.5 font-mono">{r.ticker}</td>
                <td className={`px-2 py-1.5 ${r.side === 'LONG' ? 'text-brand-up' : 'text-brand-down'}`}>
                  {r.side === 'LONG' ? 'Long' : 'Short'}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">{r.timeframe}</td>
                <td className="px-2 py-1.5 text-xs">{REASON[r.exit_reason] ?? r.exit_reason}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${Number(r.r_multiple) >= 0 ? 'text-brand-up' : 'text-brand-down'}`}>
                  {fmtR(Number(r.r_multiple))}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs hidden sm:table-cell">
                  {r.mfe_r == null ? '' : `${Number(r.mfe_r).toFixed(2)}R`}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs hidden sm:table-cell">
                  {r.mae_r == null ? '' : `${Number(r.mae_r).toFixed(2)}R`}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => {
                      if (confirm('Eliminare questo trade dalle statistiche?')) onDelete(r.id);
                    }}
                    className="text-brand-muted hover:text-brand-down"
                    aria-label="Elimina trade"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => {
          if (confirm('Azzerare tutte le statistiche del replay? Non si torna indietro.')) onReset();
        }}
        className="btn-ghost text-xs"
      >
        <Trash2 className="w-3.5 h-3.5" /> Azzera statistiche
      </button>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  const color = tone == null ? '' : tone > 0 ? 'text-brand-up' : tone < 0 ? 'text-brand-down' : '';
  return (
    <div className="card px-3 py-2">
      <div className="text-xs text-brand-muted">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-xs text-brand-muted">{sub}</div>}
    </div>
  );
}

function fmtR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}
